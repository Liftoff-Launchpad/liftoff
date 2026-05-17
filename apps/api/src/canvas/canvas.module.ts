import { Module } from '@nestjs/common';
import { DeploymentsModule } from '../deployments/deployments.module';
import { EnvironmentsModule } from '../environments/environments.module';
import { RepositoriesModule } from '../repositories/repositories.module';
import { ProjectsModule } from '../projects/projects.module';
import { CanvasController } from './canvas.controller';
import { CanvasService } from './canvas.service';

/**
 * Canvas module for Railway-inspired canvas UI.
 */
@Module({
  imports: [ProjectsModule, RepositoriesModule, EnvironmentsModule, DeploymentsModule],
  controllers: [CanvasController],
  providers: [CanvasService],
  exports: [CanvasService],
})
export class CanvasModule {}
