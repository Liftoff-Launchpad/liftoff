import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { ProjectsModule } from '../projects/projects.module';
import { QueuesModule } from '../queues/queues.module';
import { VariablesModule } from '../variables/variables.module';
import { InfrastructureController } from './infrastructure.controller';
import { InfrastructureActiveDeploymentCheckerService } from './infrastructure-active-deployment-checker.service';
import { InfrastructureProcessor } from './infrastructure.processor';
import { PulumiRunnerService } from './pulumi-runner.service';
import { InfrastructureService } from './infrastructure.service';

/**
 * Infrastructure module for preview/provision/destroy operations.
 *
 * Depends on VariablesModule (Phase 2 vault) so processors can resolve the
 * per-service runtime env vars before invoking Pulumi.
 */
@Module({
  imports: [ProjectsModule, QueuesModule, EventsModule, VariablesModule],
  controllers: [InfrastructureController],
  providers: [
    InfrastructureService,
    PulumiRunnerService,
    InfrastructureProcessor,
    InfrastructureActiveDeploymentCheckerService,
  ],
  exports: [InfrastructureService, PulumiRunnerService],
})
export class InfrastructureModule {}
