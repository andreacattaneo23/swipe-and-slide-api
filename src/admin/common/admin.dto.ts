import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * Nessun dato personale nella motivazione, che finisce nell'audit (D112): niente indirizzi email
 * né numeri di 9 o più cifre come telefoni o documenti (le date restano ammesse).
 */
export const NO_PERSONAL_DATA =
  /^(?![\s\S]*[^\s@]+@[^\s@]+\.[a-z]{2,})(?![\s\S]*(?:\d[\s.-]?){9,})[\s\S]*$/i;

/** Motivazione obbligatoria di ogni azione (D91): testo breve, senza dati personali (D112). */
export class ExplanationDto {
  @ApiProperty({
    minLength: 3,
    maxLength: 500,
    example: 'Nuova società di consulenza approvata dal team',
  })
  @IsString()
  @Length(3, 500)
  @Matches(NO_PERSONAL_DATA, { message: 'explanation.personalData' })
  explanation: string;
}

/** Motivazione facoltativa (moduli degli offsite, D238): se c'è, stesse regole. */
export class OptionalExplanationDto {
  @ApiPropertyOptional({ minLength: 3, maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(3, 500)
  @Matches(NO_PERSONAL_DATA, { message: 'explanation.personalData' })
  explanation?: string;
}

/**
 * Conferma rafforzata (D93, D244): nome o identificativo esatto digitato più la motivazione,
 * senza secondo fattore; un nome diverso è `400 confirmation.mismatch`.
 */
export class StrongConfirmationDto extends ExplanationDto {
  @ApiProperty({ description: "Nome o identificativo dell'oggetto digitato per conferma" })
  @IsString()
  @Length(1, 253)
  confirmName: string;
}
