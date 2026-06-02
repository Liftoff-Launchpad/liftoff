import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import {
  ConnectionsController,
  EnvironmentConnectionsController,
} from './connections.controller';
import { ConnectionsService } from './connections.service';

/**
 * Connections module — graph edge CRUD for the interactive canvas. Edges drive
 * env-var auto-injection at apply time (Phase B+). See INTERACTIVE_GRAPH_PLAN.md.
 */
@Module({
  imports: [ProjectsModule],
  controllers: [EnvironmentConnectionsController, ConnectionsController],
  providers: [ConnectionsService],
  exports: [ConnectionsService],
})
export class ConnectionsModule {}
