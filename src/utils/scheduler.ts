export type Turno = 'Mañana' | 'Tarde' | 'Noche' | 'Franco' | 'Vacio';

export interface StaffCSP {
  id: string;
  turnosHabilitados: Exclude<Turno, 'Franco' | 'Vacio'>[];
}

export interface ConfigCSP {
  francos_mes_corto: number;
  francos_mes_largo: number;
  min_manana: number; max_manana: number;
  min_tarde: number; max_tarde: number;
  min_noche: number; max_noche: number;
}

type TurnoTrabajo = Exclude<Turno, 'Franco' | 'Vacio'>;

const TURNOS_TRABAJO: TurnoTrabajo[] = ['Mañana', 'Tarde', 'Noche'];

function isTurnoTrabajo(t: Turno): t is TurnoTrabajo {
  return t === 'Mañana' || t === 'Tarde' || t === 'Noche';
}

function isTransitionValid(turnoAyer: Turno | null, turnoHoy: Turno): boolean {
  if (!turnoAyer || turnoAyer === 'Vacio' || turnoAyer === 'Franco') return true;
  if (turnoHoy === 'Franco') return true;
  if (turnoAyer === 'Mañana') return turnoHoy === 'Mañana' || turnoHoy === 'Tarde';
  if (turnoAyer === 'Tarde') return turnoHoy === 'Tarde' || turnoHoy === 'Noche';
  if (turnoAyer === 'Noche') return turnoHoy === 'Noche';
  return true;
}

function stableIdOrder(a: { id: string }, b: { id: string }) {
  return a.id.localeCompare(b.id, 'es');
}

export function generateSchedule(
    staffList: StaffCSP[],
    config: ConfigCSP,
    anio: number,
    mes: number
): Record<string, Turno[]> {
  const diasDelMes = new Date(anio, mes, 0).getDate();
  const targetFrancos = diasDelMes === 31 ? config.francos_mes_largo : config.francos_mes_corto;

  const cfg = {
    francos_mes_corto: Number(config.francos_mes_corto),
    francos_mes_largo: Number(config.francos_mes_largo),
    min_manana: Number(config.min_manana),
    max_manana: Number(config.max_manana),
    min_tarde: Number(config.min_tarde),
    max_tarde: Number(config.max_tarde),
    min_noche: Number(config.min_noche),
    max_noche: Number(config.max_noche),
  } satisfies ConfigCSP;

  if (!Number.isFinite(targetFrancos) || targetFrancos < 0) {
    throw new Error('Configuración inválida: francos objetivo inválido.');
  }
  for (const k of ['min_manana', 'max_manana', 'min_tarde', 'max_tarde', 'min_noche', 'max_noche'] as const) {
    if (!Number.isFinite(cfg[k]) || cfg[k] < 0) throw new Error(`Configuración inválida: ${k}.`);
  }
  if (cfg.min_manana > cfg.max_manana) throw new Error('Configuración inválida: min_manana > max_manana.');
  if (cfg.min_tarde > cfg.max_tarde) throw new Error('Configuración inválida: min_tarde > max_tarde.');
  if (cfg.min_noche > cfg.max_noche) throw new Error('Configuración inválida: min_noche > max_noche.');

  const staff = [...staffList].sort(stableIdOrder);
  const numStaff = staff.length;
  if (numStaff === 0) return {};

  const requiredMinPerDay = cfg.min_manana + cfg.min_tarde + cfg.min_noche;
  if (requiredMinPerDay > numStaff) {
    throw new Error(`Inviable: mínimos diarios (${requiredMinPerDay}) exceden el staff (${numStaff}).`);
  }

  const maxFrancosDay = numStaff - requiredMinPerDay;
  if (maxFrancosDay < 0) {
    throw new Error('Inviable: no hay capacidad diaria para francos con los mínimos actuales.');
  }

  const schedule: Turno[][] = Array.from({ length: numStaff }, () => Array<Turno>(diasDelMes).fill('Vacio'));

  const dayM = new Int16Array(diasDelMes);
  const dayT = new Int16Array(diasDelMes);
  const dayN = new Int16Array(diasDelMes);
  const dayF = new Int16Array(diasDelMes);

  const staffF = new Int16Array(numStaff);
  const staffN = new Int16Array(numStaff);
  const staffM = new Int16Array(numStaff);
  const staffT = new Int16Array(numStaff);

  const allowed = staff.map(s => {
    const set = new Set<TurnoTrabajo>();
    for (const t of s.turnosHabilitados) {
      if (TURNOS_TRABAJO.includes(t as TurnoTrabajo)) set.add(t as TurnoTrabajo);
    }
    return set;
  });

  const prevTurno = (i: number, d: number): Turno | null => (d > 0 ? schedule[i][d - 1] : null);
  const nextTurno = (i: number, d: number): Turno | null => (d + 1 < diasDelMes ? schedule[i][d + 1] : null);

  const canAssign = (i: number, d: number, t: Turno): boolean => {
    if (schedule[i][d] !== 'Vacio') return false;
    if (t === 'Vacio') return false;

    const p = prevTurno(i, d);
    const n = nextTurno(i, d);

    if (!isTransitionValid(p, t)) return false;
    if (n && n !== 'Vacio' && !isTransitionValid(t, n)) return false;

    if (t === 'Franco') {
      if (dayF[d] >= maxFrancosDay) return false;
      return true;
    }

    if (!isTurnoTrabajo(t)) return false;
    if (!allowed[i].has(t)) return false;

    if (t === 'Mañana') return dayM[d] < cfg.max_manana;
    if (t === 'Tarde') return dayT[d] < cfg.max_tarde;
    if (t === 'Noche') return dayN[d] < cfg.max_noche;
    return false;
  };

  const assign = (i: number, d: number, t: Turno) => {
    schedule[i][d] = t;
    if (t === 'Franco') {
      dayF[d]++; staffF[i]++; return;
    }
    if (t === 'Mañana') { dayM[d]++; staffM[i]++; return; }
    if (t === 'Tarde') { dayT[d]++; staffT[i]++; return; }
    if (t === 'Noche') { dayN[d]++; staffN[i]++; return; }
  };

  // ============================================================
  // CAPA 1 (CSP): NOCHES (cuello de botella) - determinista
  // ============================================================
  const nightEligible: number[] = [];
  for (let i = 0; i < numStaff; i++) if (allowed[i].has('Noche')) nightEligible.push(i);
  if (nightEligible.length < cfg.min_noche) {
    throw new Error('Inviable: no hay suficiente personal habilitado para Noche.');
  }

  for (let d = 0; d < diasDelMes; d++) {
    // Orden: menos noches acumuladas, luego id (determinista)
    nightEligible.sort((a, b) => {
      const dn = staffN[a] - staffN[b];
      if (dn !== 0) return dn;
      return staff[a].id.localeCompare(staff[b].id, 'es');
    });

    for (const i of nightEligible) {
      if (dayN[d] >= cfg.max_noche) break;
      if (!canAssign(i, d, 'Noche')) continue;
      assign(i, d, 'Noche');
    }

    if (dayN[d] < cfg.min_noche) {
      throw new Error(`Inviable: no se pudieron cubrir ${cfg.min_noche} noches el día ${d + 1}.`);
    }
  }

  // ============================================================
  // CAPA 2 (CSP): Descanso post-noche (N -> Franco si corta)
  // ============================================================
  for (let i = 0; i < numStaff; i++) {
    for (let d = 0; d < diasDelMes - 1; d++) {
      if (schedule[i][d] !== 'Noche') continue;
      if (schedule[i][d + 1] === 'Noche') continue;
      if (schedule[i][d + 1] === 'Franco') continue;
      // Forzamos franco para evitar N -> M/T (violación 24h)
      if (!canAssign(i, d + 1, 'Franco')) {
        throw new Error(`Inviable: no se pudo asignar Franco post-noche (staff=${staff[i].id}, día=${d + 2}).`);
      }
      assign(i, d + 1, 'Franco');
    }
  }

  // ============================================================
  // CAPA 3 (CSP): Completar francos exactos (sin azar)
  // ============================================================
  for (let i = 0; i < numStaff; i++) {
    const need = targetFrancos - staffF[i];
    if (need < 0) {
      throw new Error(`Inviable: staff=${staff[i].id} excede francos objetivo (${staffF[i]}/${targetFrancos}).`);
    }
    if (need === 0) continue;

    // Patrón determinista de espaciado: offset basado en hash simple del id
    let hash = 0;
    for (let k = 0; k < staff[i].id.length; k++) hash = (hash * 31 + staff[i].id.charCodeAt(k)) | 0;
    const offset = Math.abs(hash) % diasDelMes;

    // Genera una secuencia de días "saltando" para distribuir
    const step = Math.max(1, Math.floor(diasDelMes / Math.max(1, need)));
    let placed = 0;
    for (let j = 0; j < diasDelMes * 2 && placed < need; j++) {
      const d = (offset + j * step) % diasDelMes;
      if (!canAssign(i, d, 'Franco')) continue;
      // No pisar Noche (por construcción schedule[i][d] debe ser Vacio)
      assign(i, d, 'Franco');
      placed++;
    }

    if (placed < need) {
      // Fallback determinista: barrido lineal
      for (let d = 0; d < diasDelMes && placed < need; d++) {
        if (!canAssign(i, d, 'Franco')) continue;
        assign(i, d, 'Franco');
        placed++;
      }
    }

    if (placed < need) {
      throw new Error(`Inviable: no se pudieron completar francos para staff=${staff[i].id} (${staffF[i]}/${targetFrancos}).`);
    }
  }

  // ============================================================
  // CAPA 4 (CSP): Rellenar M/T cumpliendo mínimos diarios (MRV)
  // ============================================================
  const optionsCountMT = (i: number, d: number): number => {
    let c = 0;
    if (canAssign(i, d, 'Mañana')) c++;
    if (canAssign(i, d, 'Tarde')) c++;
    return c;
  };

  for (let d = 0; d < diasDelMes; d++) {
    // Primero, cubrir mínimos de Mañana
    while (dayM[d] < cfg.min_manana) {
      let bestI = -1;
      let bestOpt = 3;
      for (let i = 0; i < numStaff; i++) {
        if (!canAssign(i, d, 'Mañana')) continue;
        const opt = optionsCountMT(i, d);
        if (opt < bestOpt) { bestOpt = opt; bestI = i; continue; }
        if (opt === bestOpt && bestI !== -1) {
          // Tie-break determinista: menos mañanas acumuladas, luego id
          const dm = staffM[i] - staffM[bestI];
          if (dm < 0 || (dm === 0 && staff[i].id.localeCompare(staff[bestI].id, 'es') < 0)) bestI = i;
        }
      }
      if (bestI === -1) throw new Error(`Inviable: no se pudo cubrir min_manana el día ${d + 1}.`);
      assign(bestI, d, 'Mañana');
    }

    // Luego, cubrir mínimos de Tarde
    while (dayT[d] < cfg.min_tarde) {
      let bestI = -1;
      let bestOpt = 3;
      for (let i = 0; i < numStaff; i++) {
        if (!canAssign(i, d, 'Tarde')) continue;
        const opt = optionsCountMT(i, d);
        if (opt < bestOpt) { bestOpt = opt; bestI = i; continue; }
        if (opt === bestOpt && bestI !== -1) {
          const dt = staffT[i] - staffT[bestI];
          if (dt < 0 || (dt === 0 && staff[i].id.localeCompare(staff[bestI].id, 'es') < 0)) bestI = i;
        }
      }
      if (bestI === -1) throw new Error(`Inviable: no se pudo cubrir min_tarde el día ${d + 1}.`);
      assign(bestI, d, 'Tarde');
    }

    // Finalmente, completar con lo que quede sin exceder máximos (opcional)
    for (let i = 0; i < numStaff; i++) {
      if (schedule[i][d] !== 'Vacio') continue;
      // Prioridad determinista: balancear hacia el turno con más "holgura" restante
      const slackM = cfg.max_manana - dayM[d];
      const slackT = cfg.max_tarde - dayT[d];
      if (slackM <= 0 && slackT <= 0) continue;

      const tryOrder: TurnoTrabajo[] =
        slackM > slackT ? ['Mañana', 'Tarde', 'Noche'] : ['Tarde', 'Mañana', 'Noche'];

      for (const t of tryOrder) {
        if (t === 'Noche') continue; // Noches ya fijas (cuello de botella)
        if (!canAssign(i, d, t)) continue;
        assign(i, d, t);
        break;
      }
    }
  }

  // Verificación final de noches (suele ser exacto 2)
  for (let d = 0; d < diasDelMes; d++) {
    if (dayN[d] < cfg.min_noche || dayN[d] > cfg.max_noche) {
      throw new Error(`Inviable: noches fuera de rango el día ${d + 1} (N=${dayN[d]}).`);
    }
  }

  const result: Record<string, Turno[]> = {};
  for (let i = 0; i < numStaff; i++) result[staff[i].id] = schedule[i];
  return result;
}
