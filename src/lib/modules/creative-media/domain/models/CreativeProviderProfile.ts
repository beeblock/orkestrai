import { Model } from '@beeblock/svelar/orm';

export class CreativeProviderProfile extends Model {
  static table = 'creative_provider_profiles';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'provider', 'name', 'enabled', 'has_credential', 'revision', 'created_at', 'updated_at'];
  static casts = { enabled: 'boolean' as const, has_credential: 'boolean' as const };
}
