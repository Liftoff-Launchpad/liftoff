import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsNumber, IsString, ValidateNested } from 'class-validator';

export class NodePositionDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;
}

export class SaveLayoutDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NodePositionDto)
  nodes!: NodePositionDto[];
}
