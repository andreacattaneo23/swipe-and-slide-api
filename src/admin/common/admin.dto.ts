import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

/** Motivazione obbligatoria di ogni azione (D91): testo breve, senza dati personali (D112). */
export class ExplanationDto {
  @ApiProperty({
    minLength: 3,
    maxLength: 500,
    example: 'Nuova società di consulenza approvata dal team',
  })
  @IsString()
  @Length(3, 500)
  explanation: string;
}

/** Conferma rafforzata (D93): nome digitato più un codice TOTP appena generato. */
export class StrongConfirmationDto extends ExplanationDto {
  @ApiProperty({ description: "Nome dell'oggetto digitato per conferma" })
  @IsString()
  @Length(1, 120)
  confirmName: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/)
  totp: string;
}
