import { forwardRef, Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { QueuesModule } from '../queues/queues.module';
import { RepositoriesModule } from '../repositories/repositories.module';
import { EnvironmentVariablesController } from './environment-variables.controller';
import { ServiceVariablesController } from './service-variables.controller';
import { VariablesService } from './variables.service';

/**
 * Vault for env-scoped and service-scoped variables (Phase 2 of MULTI_SERVICE_PLAN.md).
 *
 * Imports RepositoriesModule (via forwardRef to avoid cycles since InfrastructureModule
 * pulls VariablesModule) so VariablesService can call the GitHub-side sync hooks
 * (`syncBuildVariablesForEnvironment` + `syncWorkflowForEnvironment`) after every
 * BUILD-scope mutation.
 */
@Module({
  imports: [ProjectsModule, QueuesModule, forwardRef(() => RepositoriesModule)],
  controllers: [EnvironmentVariablesController, ServiceVariablesController],
  providers: [VariablesService],
  exports: [VariablesService],
})
export class VariablesModule {}
