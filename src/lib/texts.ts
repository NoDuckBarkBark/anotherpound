import { language } from './locale';
import { de } from './texts/de';
import { en, type Texts } from './texts/en';

/** Visible texts in the language of the interface. */
export const t: Texts = language === 'de' ? de : en;
