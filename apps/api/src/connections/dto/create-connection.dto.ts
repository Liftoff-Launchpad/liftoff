import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

/**
 * Request payload for creating a graph edge. The backend infers the edge kind
 * from `sourceId`: a Resource id → RESOURCE_BINDING, a Service id → SERVICE_LINK.
 * `targetId` must always be a Service (the consumer).
 */
export class CreateConnectionDto {
  @ApiProperty({ description: 'Node id of the source (a Resource or a Service).' })
  @IsString()
  @IsNotEmpty()
  public sourceId!: string;

  @ApiProperty({ description: 'Node id of the target service (the consumer).' })
  @IsString()
  @IsNotEmpty()
  public targetId!: string;

  @ApiPropertyOptional({
    description:
      'Optional override of injected var names / subset, e.g. { "rename": { "DATABASE_URL": "DB_URL" }, "include": ["DATABASE_URL"] }. Consumed by the Phase B wiring engine.',
  })
  @IsOptional()
  @IsObject()
  public injectConfig?: Record<string, unknown>;
}
