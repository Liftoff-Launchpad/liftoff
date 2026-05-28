import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  WsDeploymentCompletePayload,
  WsDeploymentLogPayload,
  WsDeploymentStatusPayload,
  WsEvents,
  WsInfraProgressPayload,
} from '@liftoff/shared';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { MonitoringService } from '../monitoring/monitoring.service';

type HandshakeAuth = {
  token?: unknown;
};

type HandshakeHeaders = {
  authorization?: unknown;
};

/**
 * WebSocket gateway for real-time deployment events.
 */
@WebSocketGateway({
  namespace: '/deployments',
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private activeLogStreams = new Map<string, AbortController>();

  public constructor(
    private readonly jwtService: JwtService,
    private readonly monitoringService: MonitoringService,
  ) {}

  public async handleConnection(client: Socket): Promise<void> {
    const token = this.resolveToken(client);

    if (!token) {
      this.logger.warn(`Socket ${client.id} connected without token`);
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);
      client.data.userId = payload.sub;
      this.logger.debug(`Socket ${client.id} authenticated with userId: ${payload.sub}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Socket ${client.id} failed JWT verification: ${errorMessage}`);
      client.disconnect(true);
    }
  }

  public handleDisconnect(client: Socket): void {
    this.logger.debug(`Socket disconnected: ${client.id}`);
    const abortController = this.activeLogStreams.get(client.id);
    if (abortController) {
      abortController.abort();
      this.activeLogStreams.delete(client.id);
    }
  }

  @SubscribeMessage(WsEvents.JOIN_DEPLOYMENT)
  public joinDeployment(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { deploymentId: string },
  ): void {
    client.join(this.getDeploymentRoom(payload.deploymentId));
  }

  @SubscribeMessage(WsEvents.JOIN_ENVIRONMENT)
  public joinEnvironment(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { environmentId: string },
  ): void {
    client.join(this.getEnvironmentRoom(payload.environmentId));
  }

  @SubscribeMessage(WsEvents.LEAVE_DEPLOYMENT)
  public leaveDeployment(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { deploymentId: string },
  ): void {
    client.leave(this.getDeploymentRoom(payload.deploymentId));
  }

  @SubscribeMessage(WsEvents.LEAVE_ENVIRONMENT)
  public leaveEnvironment(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { environmentId: string },
  ): void {
    client.leave(this.getEnvironmentRoom(payload.environmentId));
  }

  @SubscribeMessage('start:log-stream')
  public async startLogStream(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { environmentId: string; serviceName?: string },
  ): Promise<void> {
    const userId = client.data.userId as string;

    if (!userId) {
      client.emit('error', { message: 'Not authenticated' });
      return;
    }

    try {
      await this.monitoringService.streamLogs(
        payload.environmentId,
        userId,
        client,
        payload.serviceName,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to stream logs for environment ${payload.environmentId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      client.emit('error', { message: 'Failed to stream logs' });
    }
  }

  /**
   * Broadcasts a deployment status update.
   */
  public broadcastDeploymentStatus(payload: WsDeploymentStatusPayload): void {
    this.server.to(this.getDeploymentRoom(payload.deploymentId)).emit(WsEvents.DEPLOYMENT_STATUS, payload);
  }

  /**
   * Broadcasts a deployment log line.
   */
  public broadcastDeploymentLog(payload: WsDeploymentLogPayload): void {
    this.server.to(this.getDeploymentRoom(payload.deploymentId)).emit(WsEvents.DEPLOYMENT_LOG, payload);
  }

  /**
   * Broadcasts deployment completion payload.
   */
  public broadcastDeploymentComplete(payload: WsDeploymentCompletePayload): void {
    this.server
      .to(this.getDeploymentRoom(payload.deploymentId))
      .emit(WsEvents.DEPLOYMENT_COMPLETE, payload);
  }

  /**
   * Broadcasts infrastructure progress payload.
   */
  public broadcastInfraProgress(payload: WsInfraProgressPayload): void {
    this.server
      .to(this.getDeploymentRoom(payload.deploymentId))
      .emit(WsEvents.INFRASTRUCTURE_PROGRESS, payload);
  }

  private resolveToken(client: Socket): string | undefined {
    const authToken = (client.handshake.auth as HandshakeAuth | undefined)?.token;
    if (typeof authToken === 'string' && authToken.length > 0) {
      return authToken;
    }

    const authorization = (client.handshake.headers as HandshakeHeaders | undefined)?.authorization;
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
      return authorization.slice(7);
    }

    return undefined;
  }

  private getDeploymentRoom(deploymentId: string): string {
    return `deployment:${deploymentId}`;
  }

  private getEnvironmentRoom(environmentId: string): string {
    return `environment:${environmentId}`;
  }
}
