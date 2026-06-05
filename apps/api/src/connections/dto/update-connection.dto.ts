import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional } from 'class-validator';

/**
 * Request payload for updating a graph edge. Only the injected-var override is mutable.
 */
export class UpdateConnectionDto {
  @ApiPropertyOptional({
    description: 'Override of injected var names / subset. Pass null to clear.',
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  public injectConfig?: Record<string, unknown> | null;
}
