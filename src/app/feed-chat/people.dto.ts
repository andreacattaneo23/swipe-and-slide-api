import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const DISTANCE_BANDS = [
  'same_city',
  'within_25',
  'within_50',
  'within_100',
  'within_200',
  'over_200',
] as const;
export type DistanceBand = (typeof DISTANCE_BANDS)[number];

export class PhotoDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    description: 'URL firmato di breve durata, emesso dopo il controllo della regola',
  })
  url: string;

  @ApiProperty({ description: 'URL firmato della miniatura' })
  thumbnailUrl: string;
}

export class TripPeriodDto {
  @ApiProperty({ description: 'Città mostrata della trasferta (D109), mai il comune piccolo' })
  city: string;

  @ApiProperty({ format: 'date' })
  from: string;

  @ApiProperty({ format: 'date' })
  to: string;
}

/**
 * Card del feed e dello swipe dell'offsite (D52, D152): mai cognome, azienda, città base,
 * coordinate, distanze in km, completezza o "chi ti interessa" (RC-22, RC-114).
 */
export class CardDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  age: number;

  @ApiPropertyOptional({ nullable: true, description: 'Codice della tassonomia degli ambiti' })
  practiceArea: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Codice di "cosa cerchi"' })
  lookingFor: string | null;

  @ApiProperty({ type: PhotoDto, isArray: true })
  photos: PhotoDto[];

  @ApiPropertyOptional({
    enum: DISTANCE_BANDS,
    description: "Fascia di distanza; manca nello swipe dell'offsite e con una trasferta",
  })
  distance?: DistanceBand;

  @ApiPropertyOptional({ type: TripPeriodDto, description: 'Trasferta del candidato (D50, D57)' })
  trip?: TripPeriodDto;

  @ApiPropertyOptional({
    description: "Presente e vero se la persona ha mandato un'escalation (D53)",
  })
  escalation?: true;

  @ApiPropertyOptional({
    description:
      'Presente e vero solo tra colleghi con Open space reciproco (D168); manca negli altri casi',
  })
  openSpaceColleagues?: true;
}

export class TodaySlidesDto {
  @ApiProperty({ description: 'Slide (like) rimaste oggi, bonus compresi (D136, D177)' })
  remaining: number;

  @ApiProperty({ description: '25 più 3 per ogni bonus ricevuto oggi (D54, D62)' })
  total: number;

  @ApiProperty()
  escalationsRemaining: number;
}
