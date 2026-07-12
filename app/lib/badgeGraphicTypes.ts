import { z } from "zod";

/** Visual style families — mirrors Badgy `BadgeGraphicTheme`. */
export const BADGE_GRAPHIC_THEMES = [
  "MINIMAL",
  "RETRO",
  "ELEGANT",
  "RUSTIC",
  "ECO",
] as const;

/** Semantic categories — mirrors Badgy `BadgeGraphicType`. */
export const BADGE_GRAPHIC_TYPES = [
  "OCCASION",
  "OFFER",
  "TRUST",
  "VALUES",
  "URGENCY",
  "BLANK",
] as const;

export type BadgeGraphicTheme = (typeof BADGE_GRAPHIC_THEMES)[number];
export type BadgeGraphicType = (typeof BADGE_GRAPHIC_TYPES)[number];

export const badgeGraphicThemeSchema = z.enum(BADGE_GRAPHIC_THEMES);
export const badgeGraphicTypeSchema = z.enum(BADGE_GRAPHIC_TYPES);

/** Public DTO returned to admin UI and the merchant read API. */
export interface BadgeGraphicDto {
  readonly id: string;
  readonly slug: string;
  readonly label: string;
  readonly imagePath: string;
  readonly textBaked: boolean;
  readonly theme: BadgeGraphicTheme;
  readonly graphicType: BadgeGraphicType;
  readonly sortOrder: number;
  readonly status: "ACTIVE" | "ARCHIVED";
}
