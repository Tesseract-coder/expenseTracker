import {
  DEFAULT_SETTINGS_DTO,
  type SettingsDto,
  type SettingsPatch,
  settingsPatchSchema,
  targetsSchema,
  yearModeSchema,
} from '@kharcha/shared';

/** Typed view over the key/value `settings` table (year mode, health targets, emergency fund). */
export async function getSettings(d1: D1Database, userId: string): Promise<SettingsDto> {
  const { results } = await d1
    .prepare(
      `select key, value from settings where user_id = ?1
       and key in ('year_mode', 'targets', 'emergency_fund_paise')`,
    )
    .bind(userId)
    .all<{ key: string; value: string }>();
  const raw = Object.fromEntries(
    results.map((r) => {
      try {
        return [r.key, JSON.parse(r.value) as unknown];
      } catch {
        return [r.key, null];
      }
    }),
  );
  const yearMode = yearModeSchema.safeParse(raw.year_mode);
  // Stored targets may predate newer fields (e.g. investmentRate): merge over defaults.
  const targets = targetsSchema.safeParse({
    ...DEFAULT_SETTINGS_DTO.targets,
    ...(typeof raw.targets === 'object' && raw.targets ? raw.targets : {}),
  });
  const fund = raw.emergency_fund_paise;
  return {
    yearMode: yearMode.success ? yearMode.data : DEFAULT_SETTINGS_DTO.yearMode,
    targets: targets.success ? targets.data : DEFAULT_SETTINGS_DTO.targets,
    emergencyFundPaise:
      typeof fund === 'number' && Number.isInteger(fund) && fund >= 0 ? fund : null,
  };
}

export async function updateSettings(
  d1: D1Database,
  userId: string,
  raw: SettingsPatch,
): Promise<SettingsDto> {
  const patch = settingsPatchSchema.parse(raw);
  const current = await getSettings(d1, userId);
  const now = Date.now();
  const upsert = (key: string, value: unknown) =>
    d1
      .prepare(
        `insert into settings (user_id, key, value, updated_at) values (?1, ?2, ?3, ?4)
         on conflict (user_id, key) do update set value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(userId, key, JSON.stringify(value), now);
  const stmts: D1PreparedStatement[] = [];
  if (patch.yearMode) stmts.push(upsert('year_mode', patch.yearMode));
  if (patch.targets) stmts.push(upsert('targets', { ...current.targets, ...patch.targets }));
  if (patch.emergencyFundPaise !== undefined)
    stmts.push(upsert('emergency_fund_paise', patch.emergencyFundPaise));
  await d1.batch(stmts);
  return getSettings(d1, userId);
}
