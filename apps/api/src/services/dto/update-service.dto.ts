import { PartialType } from '@nestjs/mapped-types';
import { CreateServiceDto } from './create-service.dto';

/**
 * Request payload for updating mutable Service fields.
 * All fields optional; only provided fields are persisted.
 */
export class UpdateServiceDto extends PartialType(CreateServiceDto) {}
