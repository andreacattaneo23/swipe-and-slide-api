import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class OffsiteSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ format: 'date-time' })
  startsAt: string;

  @ApiProperty({ format: 'date-time' })
  endsAt: string;

  @ApiProperty()
  city: string;

  @ApiProperty()
  venueName: string;

  @ApiPropertyOptional({ nullable: true, description: 'URL della copertina' })
  coverUrl: string | null;

  @ApiProperty({
    description:
      'Iscritti arrotondati (D167): 0 vuol dire "meno di 10", poi la decina per difetto; mai il numero esatto',
  })
  attendeesRounded: number;

  @ApiProperty()
  attending: boolean;

  @ApiProperty({ description: '"Al completo"' })
  full: boolean;

  @ApiProperty({ enum: ['published', 'cancelled', 'completed'] })
  status: string;

  @ApiProperty({ description: 'Nella città base o nelle città delle proprie trasferte' })
  highlighted: boolean;
}

export class OffsiteDetailDto extends OffsiteSummaryDto {
  @ApiProperty()
  description: string;

  @ApiProperty()
  venueAddress: string;

  @ApiProperty({ description: 'Riga "sarò all\'offsite" nel profilo (D154), spenta di base' })
  showOnProfile: boolean;

  @ApiProperty({
    description: "Swipe dell'offsite aperto: iscritto, fino a 24 ore dopo la fine (D152)",
  })
  swipeOpen: boolean;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  swipeClosesAt: string | null;
}

export class AttendancePatchDto {
  @ApiProperty()
  @IsBoolean()
  showOnProfile: boolean;
}
