import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { GitHubService } from './github.service';
import {
  ProjectRepositoriesController,
  RepositoriesController,
} from './repositories.controller';
import { RepositoriesService } from './repositories.service';
import { WorkflowGeneratorService } from './workflow-generator.service';

/**
 * Repository integration module for GitHub connection management.
 *
 * NOTE: VariablesModule imports this via forwardRef so it can call
 * `syncBuildVariablesForEnvironment` / `syncWorkflowForEnvironment` on every
 * variable mutation. Don't reach into VariablesService from here — the cycle
 * is broken by querying Prisma directly (see `collectBuildVariableKeys` etc).
 */
@Module({
  imports: [HttpModule, ProjectsModule],
  controllers: [RepositoriesController, ProjectRepositoriesController],
  providers: [GitHubService, WorkflowGeneratorService, RepositoriesService],
  exports: [GitHubService, RepositoriesService],
})
export class RepositoriesModule {}
