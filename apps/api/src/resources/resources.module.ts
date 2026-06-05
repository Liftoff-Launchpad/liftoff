import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import {
  EnvironmentResourcesController,
  ResourcesController,
} from './resources.controller';
import { ResourcesService } from './resources.service';

/**
 * Resources module — graph Resource node CRUD (managed Postgres / Redis / Spaces
 * bucket) for the interactive canvas. See INTERACTIVE_GRAPH_PLAN.md Phase A.
 */
@Module({
  imports: [ProjectsModule],
  controllers: [EnvironmentResourcesController, ResourcesController],
  providers: [ResourcesService],
  exports: [ResourcesService],
})
export class ResourcesModule {}
