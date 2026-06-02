import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { RepositoriesModule } from '../repositories/repositories.module';
import {
  EnvironmentServicesController,
  ServicesController,
} from './services.controller';
import { ServicesService } from './services.service';

/**
 * Services module — per-environment Service CRUD (multi-service support per Phase 1
 * of MULTI_SERVICE_PLAN.md). A Service represents one App Platform component
 * (service, worker, job, static_site) within the environment's single DO App.
 *
 * Depends on RepositoriesModule to re-commit `.github/workflows/liftoff-deploy.yml`
 * whenever the env's services change so the next push builds the right set.
 */
@Module({
  imports: [ProjectsModule, RepositoriesModule],
  controllers: [EnvironmentServicesController, ServicesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}
