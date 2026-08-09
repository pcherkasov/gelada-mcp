export type AbstractModelProfile = 'FAST' | 'BALANCED' | 'DEEP' | 'DEFAULT' | string;

export class ModelRouter {
  public resolveAgyModel(profile?: AbstractModelProfile): string {
    if (!profile) return 'inherit';

    const upper = profile.toUpperCase();
    switch (upper) {
      case 'FAST':
        return 'flash';
      case 'BALANCED':
      case 'DEFAULT':
        return 'inherit';
      case 'DEEP':
        return 'pro';
      default:
        // Pass through custom/explicit models
        return profile.toLowerCase();
    }
  }
}
