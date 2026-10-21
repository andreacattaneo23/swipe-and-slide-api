import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { DISTANCE_BANDS, type DistanceBand } from '../feed-chat/people.dto';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const GENDERS = ['woman', 'man', 'non_binary', 'undisclosed'] as const;
const INTERESTED_IN = ['men', 'women', 'everyone'] as const;
const DISTANCES = ['city', 'km25', 'km50', 'km100', 'km200', 'italy'] as const;
const PHOTO_STATUSES = [
  'uploading',
  'checking',
  'pending_approval',
  'approved',
  'under_review',
  'rejected',
] as const;

export class CodeLabelDto {
  @ApiProperty()
  code: string;

  @ApiProperty()
  label: string;
}

export class LookingForOptionDto extends CodeLabelDto {
  @ApiProperty({ enum: ['long_term', 'dating', 'unsure'], description: 'Valore di fondo (D130)' })
  intent: string;
}

export class InterestOptionDto extends CodeLabelDto {
  @ApiProperty({ enum: ['classic', 'consultant'] })
  section: 'classic' | 'consultant';
}

export class ProfileQuestionDto extends CodeLabelDto {
  @ApiProperty({ description: 'Testo della domanda a tema' })
  text: string;
}

export class TaxonomiesDto {
  @ApiProperty({ type: LookingForOptionDto, isArray: true })
  lookingFor: LookingForOptionDto[];

  @ApiProperty({ type: InterestOptionDto, isArray: true })
  interests: InterestOptionDto[];

  @ApiProperty({ type: CodeLabelDto, isArray: true })
  practiceAreas: CodeLabelDto[];

  @ApiProperty({ type: ProfileQuestionDto, isArray: true })
  profileQuestions: ProfileQuestionDto[];
}

export class OwnPhotoDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Ordine da 1 a 6; la prima è la principale' })
  position: number;

  @ApiProperty({
    enum: PHOTO_STATUSES,
    description: 'Visibile agli altri solo `approved` (D143); le altre solo all’utente',
  })
  status: string;

  @ApiPropertyOptional({ nullable: true, description: 'URL firmato di pochi minuti' })
  url: string | null;

  @ApiPropertyOptional({ nullable: true })
  thumbnailUrl: string | null;
}

export class SignedUploadDto {
  @ApiProperty({ description: 'URL firmato per caricare il file con PUT, valido 10 minuti' })
  url: string;

  @ApiProperty({ enum: ['PUT'] })
  method: 'PUT';

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty({ description: 'Dimensione massima del file in byte' })
  maxBytes: number;
}

export class PhotoUploadDto {
  @ApiProperty({ type: OwnPhotoDto })
  photo: OwnPhotoDto;

  @ApiProperty({ type: SignedUploadDto })
  upload: SignedUploadDto;
}

export class PhotoOrderDto {
  @ApiProperty({ type: String, isArray: true, description: 'Identificativi nel nuovo ordine' })
  @IsArray()
  @ArrayMaxSize(6)
  @IsUUID('4', { each: true })
  photoIds: string[];
}

export class CityRefDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  provinceCode: string;
}

export class PreferencesDto {
  @ApiProperty()
  ageMin: number;

  @ApiProperty()
  ageMax: number;

  @ApiProperty({ enum: DISTANCES })
  maxDistance: string;
}

export class AnswerDto {
  @ApiProperty({ description: 'Codice della domanda a tema' })
  @IsString()
  @Length(1, 40)
  question: string;

  @ApiProperty({ description: 'Risposta, fino a 150 caratteri (D56)' })
  @IsString()
  @MaxLength(150)
  answer: string;
}

export class OwnProfileDto {
  @ApiPropertyOptional({ nullable: true })
  firstName: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Lo vede solo la persona del match (D56)' })
  lastName: string | null;

  @ApiProperty({ description: 'Solo per l’utente stesso; si corregge solo dal Supporto (D112)' })
  birthDate: string;

  @ApiProperty()
  age: number;

  @ApiPropertyOptional({ enum: GENDERS, nullable: true })
  gender: string | null;

  @ApiPropertyOptional({ enum: INTERESTED_IN, nullable: true, description: 'Mai mostrato (D47)' })
  interestedIn: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Codice di "cosa cerchi"' })
  lookingFor: string | null;

  @ApiPropertyOptional({ nullable: true })
  bio: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Codice dell’ambito' })
  practiceArea: string | null;

  @ApiPropertyOptional({ type: CityRefDto, nullable: true, description: 'Mai mostrata agli altri' })
  homeCity: CityRefDto | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Solo oltre il limite: da quando si potrà cambiare la città base',
  })
  homeCityChangeableAt: Date | null;

  @ApiProperty({ type: PreferencesDto })
  preferences: PreferencesDto;

  @ApiProperty({ description: '"Mostra il calendario nel profilo" (D109)' })
  showCalendar: boolean;

  @ApiProperty({ description: 'Conferme di lettura (D63)' })
  readReceipts: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Modalità OOO attiva da (D81)' })
  oooSince: Date | null;

  @ApiProperty({ description: 'Profilo completo (D51)' })
  isComplete: boolean;

  @ApiProperty({
    enum: ['photos', 'firstName', 'gender', 'interestedIn', 'homeCity'],
    isArray: true,
    description: 'Cosa manca per il profilo completo',
  })
  missing: string[];

  @ApiProperty({ type: String, isArray: true, description: 'Codici degli interessi' })
  interests: string[];

  @ApiProperty({ type: AnswerDto, isArray: true })
  answers: AnswerDto[];

  @ApiProperty({ type: OwnPhotoDto, isArray: true })
  photos: OwnPhotoDto[];
}

/** Modifica per gruppo: ogni campo è facoltativo; la data di nascita non è ammessa (D112). */
export class ProfilePatchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(/\S/)
  firstName?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  lastName?: string | null;

  @ApiPropertyOptional({ enum: GENDERS })
  @IsOptional()
  @IsIn(GENDERS)
  gender?: (typeof GENDERS)[number];

  @ApiPropertyOptional({ enum: INTERESTED_IN })
  @IsOptional()
  @IsIn(INTERESTED_IN)
  interestedIn?: (typeof INTERESTED_IN)[number];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  lookingFor?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Fino a 300 caratteri (D48)' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  bio?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  practiceArea?: string | null;

  @ApiPropertyOptional({ description: 'Codice ISTAT del comune' })
  @IsOptional()
  @Matches(/^[0-9]{6}$/)
  homeCityId?: string;

  @ApiPropertyOptional({ minimum: 18, maximum: 99 })
  @IsOptional()
  @IsInt()
  @Min(18)
  @Max(99)
  ageMin?: number;

  @ApiPropertyOptional({ minimum: 18, maximum: 99 })
  @IsOptional()
  @IsInt()
  @Min(18)
  @Max(99)
  ageMax?: number;

  @ApiPropertyOptional({ enum: DISTANCES })
  @IsOptional()
  @IsIn(DISTANCES)
  maxDistance?: (typeof DISTANCES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showCalendar?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  readReceipts?: boolean;

  @ApiPropertyOptional({ description: '"Vai in OOO" (vero) e "Torna operativo" (falso), D81' })
  @IsOptional()
  @IsBoolean()
  ooo?: boolean;
}

export class InterestsDto {
  @ApiProperty({ type: String, isArray: true, description: 'Fino a 5 codici in tutto (D48)' })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  interests: string[];
}

export class AnswersDto {
  @ApiProperty({ type: AnswerDto, isArray: true, description: 'Fino a 3 domande (D56)' })
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers: AnswerDto[];
}

export class DeckPhotoDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  url: string;

  @ApiProperty()
  thumbnailUrl: string;
}

export class DeckAnswerDto {
  @ApiProperty()
  question: string;

  @ApiProperty()
  text: string;

  @ApiProperty()
  answer: string;
}

export class DeckTripDto {
  @ApiProperty({ description: 'Città mostrata (D109)' })
  cityName: string;

  @ApiProperty()
  startDate: string;

  @ApiProperty()
  endDate: string;
}

export class DeckOffsiteDto {
  @ApiProperty()
  offsiteId: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ description: "Città dell'offsite" })
  city: string;

  @ApiProperty()
  startsAt: Date;
}

/** Profilo dal feed: mai cognome, azienda, città base né altri dati privati (D30, RC-62). */
export class ProfileDeckDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  age: number;

  @ApiPropertyOptional({ enum: GENDERS, nullable: true })
  gender: string | null;

  @ApiPropertyOptional({ type: CodeLabelDto, nullable: true })
  practiceArea: CodeLabelDto | null;

  @ApiPropertyOptional({ type: CodeLabelDto, nullable: true })
  lookingFor: CodeLabelDto | null;

  @ApiPropertyOptional({ nullable: true })
  bio: string | null;

  @ApiProperty({ type: DeckPhotoDto, isArray: true })
  photos: DeckPhotoDto[];

  @ApiProperty({ type: InterestOptionDto, isArray: true })
  interests: InterestOptionDto[];

  @ApiProperty({ type: DeckAnswerDto, isArray: true })
  answers: DeckAnswerDto[];

  @ApiProperty({ type: DeckTripDto, isArray: true, description: 'Solo nei 14 giorni prima' })
  trips: DeckTripDto[];

  @ApiProperty({ type: DeckOffsiteDto, isArray: true, description: '"Sarò all’offsite" (D154)' })
  offsites: DeckOffsiteDto[];

  @ApiProperty({ description: 'Badge "Open space" (D168)' })
  openSpaceColleagues: boolean;

  @ApiPropertyOptional({
    enum: DISTANCE_BANDS,
    description: 'Fascia di distanza dal feed (D49), mai i km; manca dal match',
  })
  distance?: DistanceBand;

  @ApiPropertyOptional({
    description: "Presente e vero se la persona ha mandato un'escalation (D53)",
  })
  escalation?: true;
}

/** Profilo dal match: anche cognome e nome dell'azienda attuale (D30, D56, D107). */
export class MatchProfileDto extends ProfileDeckDto {
  @ApiPropertyOptional({ nullable: true })
  lastName: string | null;

  @ApiProperty({ description: "Nome dell'azienda attuale, mai l'identificativo (RC-63)" })
  companyName: string;
}
