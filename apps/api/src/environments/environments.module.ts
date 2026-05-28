import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { RepositoriesModule } from '../repositories/repositories.module';
import { VariablesModule } from '../variables/variables.module';
import { EnvironmentsController } from './environments.controller';
import { EnvironmentsService } from './environments.service';

/**
 * Environments module with project-scoped environment CRUD + env-level redeploy.
 *
 * Imports VariablesModule so the redeploy endpoint can reuse VariablesService's
 * `applyVariables` plumbing (same bundle/Pulumi-up flow; reuses each service's
 * latest SUCCESS image).
 */
@Module({
  imports: [ProjectsModule, RepositoriesModule, VariablesModule],
  controllers: [EnvironmentsController],
  providers: [EnvironmentsService],
  exports: [EnvironmentsService],
})
export class EnvironmentsModule {}
