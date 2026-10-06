import type {Config, Master} from './types';

/** Check saved UI conditions at the React boundary without changing the v1 backup. */
export function validConfig(config: Config | null | undefined, master: Master): config is Config {
  if (!config || !master.areas.some(area => area.areaId === config.area)) return false;
  const month = (value: string) => typeof value === 'string' && (value === '' || /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
  return ['A', 'AB', 'ABC', 'ALL'].includes(config.scope)
    && ['name', 'position'].includes(config.direction)
    && ['10', '20', 'all'].includes(config.size)
    && ['all', '10', '5', 'custom'].includes(config.period)
    && month(config.from) && month(config.to);
}
