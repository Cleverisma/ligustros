import { component$, useComputed$, $, useSignal, useTask$, useOnDocument } from '@builder.io/qwik';
import type { ActionStore } from '@builder.io/qwik-city';
import type { TurnoAsignado, Staff, ReglaDisponibilidad, ConfiguracionGlobal } from '../../types';
import { type StaffCSP, type Turno, type ConfigCSP, generarMatrizTurnos } from '../../lib/scheduler';

export interface RosterGridProps {
    staffList: Staff[];
    assignments: TurnoAsignado[];
    rules: ReglaDisponibilidad[];
    mes: number;
    anio: number;
    toggleAction: any; // Qwik City server$ function
    saveGeneratedAction: ActionStore<any, any, true>; // Qwik City globalAction$
    clearMonthAction: ActionStore<any, any, true>;
    config: ConfiguracionGlobal;
}

export const RosterGrid = component$<RosterGridProps>((props) => {

    // Paleta de Herramientas (Pincel Activo)
    const activeTool = useSignal<'Mañana' | 'Tarde' | 'Noche' | 'Franco' | 'Vacío'>('Mañana');
    const isEmptyStateDismissed = useSignal<boolean>(false);

    // Atajos de teclado para Power Users
    useOnDocument('keydown', $((event: KeyboardEvent) => {
        const target = event.target as HTMLElement;
        if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

        const key = event.key.toLowerCase();
        switch (key) {
            case 'm': activeTool.value = 'Mañana'; break;
            case 't': activeTool.value = 'Tarde'; break;
            case 'n': activeTool.value = 'Noche'; break;
            case 'f': activeTool.value = 'Franco'; break;
            case 'x':
            case 'delete':
            case 'backspace': activeTool.value = 'Vacío'; break;
        }
    }));

    // ESTADO OPTIMISTA (Latencia Cero)
    // Sincronizamos las props del servidor en signals locales.
    // Cuando el Action de Qwik redibuja con nuevos props tras el submit, 
    // el useTask$ absorbe los cambios garantizando una fuente de verdad única sin lag.
    const localAssignments = useSignal([...props.assignments]);
    const localRules = useSignal([...props.rules]);
    const isGeneratingClientSide = useSignal<boolean>(false);
    const engineErrorClientSide = useSignal<string | null>(null);

    useTask$(({ track }) => {
        const serverAssigns = track(() => props.assignments);
        const serverRules = track(() => props.rules);
        localAssignments.value = [...serverAssigns];
        localRules.value = [...serverRules];
    });

    const diasDelMes = useComputed$(() => new Date(props.anio, props.mes, 0).getDate());
    // Objetivo de francos dinámico: 6 para meses de 30 días, 7 para meses de 31
    const targetFrancos = useComputed$(() => diasDelMes.value === 31 ? 7 : 6);

    // Configuración de los días del mes
    const daysData = useComputed$(() => {
        const days = [];
        const maxDias = diasDelMes.value;
        for (let dia = 1; dia <= maxDias; dia++) {
            const fecha = new Date(props.anio, props.mes - 1, dia);
            const nombreDia = new Intl.DateTimeFormat('es-AR', { weekday: 'short' }).format(fecha);
            const fechaString = `${props.anio}-${String(props.mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
            days.push({
                dia,
                nombreDia: nombreDia[0].toUpperCase() + nombreDia.slice(1),
                fechaString,
                isWeekend: fecha.getDay() === 0 || fecha.getDay() === 6
            });
        }
        return days;
    });

    // Matriz de Staff x Días con MOTOR DE REGLAS (Reactividad Pura)
    const dataComputed = useComputed$(() => {
        const assigns = localAssignments.value;
        const rules = localRules.value;

        // 1. Agrupar turnos y reglas para acceso O(1)
        const assignsByStaffAndDay: Record<string, string> = {};
        assigns.forEach(a => { assignsByStaffAndDay[`${a.staff_id}_${a.dia}`] = a.turno; });

        const rulesByStaffAndDay: Record<string, string> = {};
        rules.forEach(r => { rulesByStaffAndDay[`${r.staff_id}_${r.fecha}`] = r.tipo; });

        // 2. Filas (Empleados)
        const maxDias = diasDelMes.value;
        const targetF = targetFrancos.value;

        // Ordenar staff: Mañana -> Tarde -> Noche
        const getShiftWeight = (staffMember: Staff) => {
            const rawOptions = staffMember.modalidad_turno || staffMember.turno_preferido || '';
            const shifts = rawOptions.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

            if (shifts.includes('M') || rawOptions === 'MIXTO' || rawOptions === '') return 1;
            if (shifts.includes('T')) return 2;
            if (shifts.includes('N')) return 3;
            return 4;
        };

        const sortedStaff = [...props.staffList].sort((a, b) => {
            const weightA = getShiftWeight(a);
            const weightB = getShiftWeight(b);
            if (weightA !== weightB) return weightA - weightB;
            return a.nombre.localeCompare(b.nombre, 'es');
        });

        const rows = sortedStaff.map(staffMember => {
            const francosCount = rules.filter(r => r.staff_id === staffMember.id && r.tipo === 'Franco').length;

            const cellData: Record<string, { state: string; isViolation: boolean }> = {};

            for (let dia = 1; dia <= maxDias; dia++) {
                // Format dates inline to avoid serialization issues with closures in Qwik
                const fechaString = `${props.anio}-${String(props.mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
                const ayerString = dia > 1 ? `${props.anio}-${String(props.mes).padStart(2, '0')}-${String(dia - 1).padStart(2, '0')}` : null;

                const tipoRegla = rulesByStaffAndDay[`${staffMember.id}_${fechaString}`];
                const turnoHoy = assignsByStaffAndDay[`${staffMember.id}_${fechaString}`];

                let state = 'Vacío';
                if (tipoRegla === 'Franco') state = 'Franco';
                else if (turnoHoy) state = turnoHoy;

                // Hard Limit 24hs Violation -> Restringe rotar a un turno que empiece más temprano (Ej: Tarde->Mañana, Noche->Mañana/Tarde)
                let isViolation = false;
                if (ayerString && state !== 'Vacío' && state !== 'Franco') {
                    const turnoAyer = assignsByStaffAndDay[`${staffMember.id}_${ayerString}`];
                    if (turnoAyer === 'Tarde' && state === 'Mañana') {
                        isViolation = true;
                    } else if (turnoAyer === 'Noche' && (state === 'Mañana' || state === 'Tarde')) {
                        isViolation = true;
                    }
                }

                cellData[fechaString] = { state, isViolation };
            }

            return {
                staff: staffMember,
                francosTotales: francosCount,
                francosCorrectos: francosCount === targetF, // Validación 1 usa targetFrancos
                cells: cellData
            };
        });

        // 3. Totales (Columnas - Cobertura Diaria)
        const dailyTotals: Record<string, { M: number, T: number, N: number }> = {};
        daysData.value.forEach(dayInfo => {
            dailyTotals[dayInfo.fechaString] = { M: 0, T: 0, N: 0 };
        });

        assigns.forEach(a => {
            if (dailyTotals[a.dia]) {
                if (a.turno === 'Mañana') dailyTotals[a.dia].M++;
                if (a.turno === 'Tarde') dailyTotals[a.dia].T++;
                if (a.turno === 'Noche') dailyTotals[a.dia].N++;
            }
        });

        return { rows, dailyTotals };
    });

    // Detectar globalmente si hay alguna violación de descanso o francos en la tabla actual
    const hasViolations = useComputed$(() => {
        const hasRestViolations = dataComputed.value.rows.some(r => Object.values(r.cells).some(c => c.isViolation));
        
        // Únicamente mostramos error de francos si *todo el mes* ya fue asignado (no quedan Vacíos)
        const isMonthComplete = dataComputed.value.rows.every(r => 
            Object.values(r.cells).every(c => c.state !== 'Vacío')
        );
        const hasFrancoViolations = isMonthComplete && dataComputed.value.rows.some(r => !r.francosCorrectos);
        
        return { hasRestViolations, hasFrancoViolations };
    });

    // Acción Optimista -> Pintar con herramienta activa
    const handleCellClick = $((staffId: string, fecha: string, currentState: string) => {
        const nextState = activeTool.value;

        if (currentState === nextState) return;

        // Múltiples mutaciones síncronas para respuesta <1ms en UI
        localAssignments.value = localAssignments.value.filter(a => !(a.staff_id === staffId && a.dia === fecha));
        localRules.value = localRules.value.filter(r => !(r.staff_id === staffId && r.fecha === fecha));

        if (nextState !== 'Vacío' && nextState !== 'Franco') {
            localAssignments.value = [...localAssignments.value, { dia: fecha, turno: nextState as any, staff_id: staffId }];
        } else if (nextState === 'Franco') {
            localRules.value = [...localRules.value, { fecha, tipo: 'Franco', staff_id: staffId }];
        }

        // Llamada asíncrona real a la BD
        props.toggleAction({
            staff_id: staffId,
            fecha: fecha,
            tipo_asignacion: nextState
        });
    });

    const getCellColor = (state: string, isViolation: boolean) => {
        const base = isViolation
            ? 'ring-2 ring-rose-500 dark:ring-rose-400 ring-inset shadow-[0_0_8px_rgba(244,63,94,0.4)] z-10 relative '
            : '';

        switch (state) {
            case 'Mañana': return base + 'bg-emerald-100/90 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800/60 border-emerald-200 dark:border-emerald-800/50';
            case 'Tarde': return base + 'bg-orange-100/90 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-800/60 border-orange-200 dark:border-orange-800/50';
            case 'Noche': return base + 'bg-indigo-100/90 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800/60 border-indigo-200 dark:border-indigo-800/50';
            case 'Franco': return base + 'bg-zinc-200/80 dark:bg-slate-700/80 text-zinc-600 dark:text-slate-300 hover:bg-zinc-300 dark:hover:bg-slate-600 border-zinc-300 dark:border-slate-600 font-medium';
            case 'Vacío': return base + 'bg-transparent text-transparent hover:bg-slate-100 dark:hover:bg-slate-800/50 border-transparent';
            default: return base + 'bg-transparent text-slate-300 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800/50 border-transparent';
        }
    };

    const getCellLabel = (state: string) => {
        switch (state) {
            case 'Mañana': return 'M';
            case 'Tarde': return 'T';
            case 'Noche': return 'N';
            case 'Franco': return 'F';
            default: return '·';
        }
    };

    return (
        <div class="flex flex-col h-full bg-white dark:bg-slate-900 transition-colors">
            {/* Cabecera / Leyenda */}
            <div class="px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex justify-between items-center shrink-0 transition-colors">
                <h2 class="font-bold text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-2">
                    <svg class="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                    Planilla de Asignación <span class="text-slate-500 dark:text-slate-400 font-medium ml-2">| {new Intl.DateTimeFormat('es-AR', { month: 'short', year: 'numeric' }).format(new Date(props.anio, props.mes - 1, 1)).toUpperCase()}</span>
                </h2>
                <div class="flex items-center gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 uppercase tracking-widest">
                    <div class="w-3 h-3 rounded-sm border-2 border-rose-500 dark:border-rose-400"></div> Descanso &lt; 24h
                </div>
            </div>

            {/* Barra de Herramientas (Paleta) */}
            <div class="px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center gap-4 shrink-0 shadow-sm relative z-10 transition-colors">
                <span class="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mr-2">Turnos:</span>

                <button
                    onClick$={() => activeTool.value = 'Mañana'}
                    class={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all text-sm font-medium ${activeTool.value === 'Mañana' ? 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 ring-2 ring-emerald-500 ring-offset-2 dark:ring-offset-slate-900 shadow-md scale-105' : 'bg-slate-100 dark:bg-slate-800/80 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 text-slate-600 dark:text-slate-400'}`}
                    title="Atajo de teclado: M"
                    type="button"
                >
                    <div class="w-3 h-3 rounded-sm bg-emerald-400 dark:bg-emerald-600 shadow-inner"></div> Mañana <kbd class="ml-1 text-[10px] font-mono bg-white/60 dark:bg-black/20 px-1.5 py-0.5 rounded text-emerald-700 dark:text-emerald-300 font-bold shadow-sm">M</kbd>
                </button>

                <button
                    onClick$={() => activeTool.value = 'Tarde'}
                    class={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all text-sm font-medium ${activeTool.value === 'Tarde' ? 'bg-orange-100 dark:bg-orange-900/60 text-orange-800 dark:text-orange-300 ring-2 ring-orange-500 ring-offset-2 dark:ring-offset-slate-900 shadow-md scale-105' : 'bg-slate-100 dark:bg-slate-800/80 hover:bg-orange-50 dark:hover:bg-orange-900/30 text-slate-600 dark:text-slate-400'}`}
                    title="Atajo de teclado: T"
                    type="button"
                >
                    <div class="w-3 h-3 rounded-sm bg-orange-400 dark:bg-orange-600 shadow-inner"></div> Tarde <kbd class="ml-1 text-[10px] font-mono bg-white/60 dark:bg-black/20 px-1.5 py-0.5 rounded text-orange-700 dark:text-orange-300 font-bold shadow-sm">T</kbd>
                </button>

                <button
                    onClick$={() => activeTool.value = 'Noche'}
                    class={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all text-sm font-medium ${activeTool.value === 'Noche' ? 'bg-indigo-100 dark:bg-indigo-900/60 text-indigo-800 dark:text-indigo-300 ring-2 ring-indigo-500 ring-offset-2 dark:ring-offset-slate-900 shadow-md scale-105' : 'bg-slate-100 dark:bg-slate-800/80 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-slate-600 dark:text-slate-400'}`}
                    title="Atajo de teclado: N"
                    type="button"
                >
                    <div class="w-3 h-3 rounded-sm bg-indigo-400 dark:bg-indigo-600 shadow-inner"></div> Noche <kbd class="ml-1 text-[10px] font-mono bg-white/60 dark:bg-black/20 px-1.5 py-0.5 rounded text-indigo-700 dark:text-indigo-300 font-bold shadow-sm">N</kbd>
                </button>

                <button
                    onClick$={() => activeTool.value = 'Franco'}
                    class={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all text-sm font-medium ${activeTool.value === 'Franco' ? 'bg-zinc-200 dark:bg-slate-700 text-zinc-900 dark:text-slate-100 ring-2 ring-zinc-500 dark:ring-slate-400 ring-offset-2 dark:ring-offset-slate-900 shadow-md scale-105' : 'bg-slate-100 dark:bg-slate-800/80 hover:bg-zinc-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400'}`}
                    title="Atajo de teclado: F"
                    type="button"
                >
                    <div class="w-3 h-3 rounded-sm bg-zinc-400 dark:bg-slate-500 shadow-inner"></div> Franco <kbd class="ml-1 text-[10px] font-mono bg-white/60 dark:bg-black/20 px-1.5 py-0.5 rounded text-zinc-800 dark:text-slate-200 font-bold shadow-sm">F</kbd>
                </button>

                <div class="w-px h-8 bg-slate-300 dark:bg-slate-700 mx-2 transition-colors"></div>

                <button
                    onClick$={() => activeTool.value = 'Vacío'}
                    class={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all text-sm font-medium ${activeTool.value === 'Vacío' ? 'bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-300 ring-2 ring-rose-500 ring-offset-2 dark:ring-offset-slate-900 shadow-md scale-105' : 'bg-slate-100 dark:bg-slate-800/80 hover:bg-rose-50 dark:hover:bg-rose-900/30 text-slate-600 dark:text-slate-400'}`}
                    title="Atajo de teclado: X, Suprimir o Esc"
                    type="button"
                >
                    <svg class="w-4 h-4 text-rose-500 dark:text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    Borrar <kbd class="ml-1 text-[10px] font-mono bg-white/60 dark:bg-black/20 px-1.5 py-0.5 rounded text-rose-700 dark:text-rose-300 font-bold shadow-sm">X</kbd>
                </button>

                <div class="ml-auto flex items-center gap-3">
                    <button
                        onClick$={async () => {
                            if (window.confirm('¿Estás seguro de que deseas automatizar y sobreescribir la planilla entera de este mes?')) {
                                isGeneratingClientSide.value = true;
                                engineErrorClientSide.value = null;

                                // Allow UI to paint loading state briefly
                                await new Promise(res => setTimeout(res, 50));

                                try {
                                    const staffMapped: StaffCSP[] = props.staffList.map(s => {
                                      let enabledTurnos: Exclude<Turno, 'Franco' | 'Vacio'>[] = [];
                                      const rawOptions = s.modalidad_turno || s.turno_preferido || '';
                                
                                      if (rawOptions === 'MIXTO' || rawOptions === '') {
                                        enabledTurnos = ['Mañana', 'Tarde', 'Noche'];
                                      } else {
                                        const letters = rawOptions.split(',').map(l => l.trim()).filter(Boolean);
                                        if (letters.includes('M')) enabledTurnos.push('Mañana');
                                        if (letters.includes('T')) enabledTurnos.push('Tarde');
                                        if (letters.includes('N')) enabledTurnos.push('Noche');
                                      }
                                
                                      return {
                                        id: s.id,
                                        turnosHabilitados: enabledTurnos,
                                      };
                                    }).filter(s => s.turnosHabilitados.length > 0);

                                    const configCSP: ConfigCSP = {
                                      francos_mes_corto: Number(props.config.francos_mes_corto) || 6,
                                      francos_mes_largo: Number(props.config.francos_mes_largo) || 7,
                                      min_manana: Number(props.config.min_manana) || 0,
                                      max_manana: Number(props.config.max_manana) || 0,
                                      min_tarde: Number(props.config.min_tarde) || 0,
                                      max_tarde: Number(props.config.max_tarde) || 0,
                                      min_noche: Number(props.config.min_noche) || 2,
                                      max_noche: Number(props.config.max_noche) || 2,
                                    };

                                    const diasDelMesClient = diasDelMes.value;
                                    
                                    // 🚀 COMPUTE INTENSIVE LOAD HAPPENS HERE (User's Browser)
                                    const cspResult = generarMatrizTurnos(staffMapped, configCSP, diasDelMesClient);
                                    
                                    // Map computed matrix to Flat Array for dumb insert
                                    const payloadAsignaciones: { staff_id: string, dia: string, turno: string }[] = [];
                                    const newLocalAssigns: TurnoAsignado[] = [];
                                    const newLocalRules: ReglaDisponibilidad[] = [];

                                    const targetMonthStr = `${props.anio}-${String(props.mes).padStart(2, '0')}`;

                                    for (const staffId in cspResult) {
                                      const schedule = cspResult[staffId];
                                      for (let dayIndex = 0; dayIndex < schedule.length && dayIndex < diasDelMesClient; dayIndex++) {
                                        const diaInt = dayIndex + 1;
                                        const dateString = `${targetMonthStr}-${String(diaInt).padStart(2, '0')}`;
                                        const rTurno = schedule[dayIndex];

                                        payloadAsignaciones.push({ staff_id: staffId, dia: dateString, turno: rTurno });

                                        // Push directly to signals for optimistic painting
                                        if (rTurno === 'Franco') {
                                          newLocalRules.push({ fecha: dateString, tipo: 'Franco', staff_id: staffId } as any);
                                        } else if (rTurno !== 'Vacio') {
                                          newLocalAssigns.push({ dia: dateString, turno: rTurno, staff_id: staffId } as any);
                                        }
                                      }
                                    }

                                    // Local Optimistic Update
                                    localAssignments.value = newLocalAssigns;
                                    localRules.value = newLocalRules;

                                    // Sync entirely computed block via Dumb Insert
                                    props.saveGeneratedAction.submit({
                                      anio: props.anio,
                                      mes: props.mes,
                                      asignaciones: payloadAsignaciones
                                    });

                                } catch (e: any) {
                                    engineErrorClientSide.value = e.message;
                                    console.error("Motor CSP Error:", e);
                                } finally {
                                    isGeneratingClientSide.value = false;
                                }
                            }
                        }}
                        disabled={isGeneratingClientSide.value}
                        title="Generar la planilla óptima automáticamente usando la computadora local"
                        class="px-3 py-2 rounded-lg text-sm font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-800/50 shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                        type="button"
                    >
                        {isGeneratingClientSide.value ? 'Generando (Client-Side)...' : '✨ Auto-Generar'}
                    </button>
                    <button
                        onClick$={() => {
                            if (window.confirm('¿Estás seguro de que deseas borrar TODA la planilla del mes? Esta acción no se puede deshacer.')) {
                                props.clearMonthAction.submit({ anio: props.anio, mes: props.mes });
                            }
                        }}
                        disabled={props.clearMonthAction.isRunning}
                        title="Borrar completamente la asignación de este mes"
                        class="px-3 py-2 rounded-lg text-sm font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 dark:bg-rose-900/40 dark:text-rose-300 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-800/50 shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                        type="button"
                    >
                        {props.clearMonthAction.isRunning ? 'Borrando...' : '🗑️ Borrar Todo'}
                    </button>
                </div>
            </div>

            <div class="overflow-x-auto overflow-y-auto w-full custom-scrollbar flex-1 relative bg-white dark:bg-slate-900 transition-colors">

                {props.assignments.length === 0 && !isEmptyStateDismissed.value ? (
                    <div class="flex flex-col items-center justify-center p-12 text-center h-full min-h-[400px]">
                        <div class="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/50 rounded-2xl flex items-center justify-center mb-5 shadow-sm">
                            <svg class="w-8 h-8 text-indigo-500 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                        </div>
                        <h3 class="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">Aún no hay turnos planificados para este mes</h3>
                        <p class="text-slate-500 dark:text-slate-400 max-w-sm mb-8">
                            Puedes empezar copiando el esquema del mes pasado, o empezar a asignar en una planilla en blanco.
                        </p>

                        <div class="flex flex-col sm:flex-row gap-3">
                            <button
                                onClick$={async () => {
                                    isGeneratingClientSide.value = true;
                                    engineErrorClientSide.value = null;

                                    // Drop browser thread
                                    await new Promise(res => setTimeout(res, 50));

                                    try {
                                        const staffMapped: StaffCSP[] = props.staffList.map(s => {
                                          let enabledTurnos: Exclude<Turno, 'Franco' | 'Vacio'>[] = [];
                                          const rawOptions = s.modalidad_turno || s.turno_preferido || '';
                                    
                                          if (rawOptions === 'MIXTO' || rawOptions === '') {
                                            enabledTurnos = ['Mañana', 'Tarde', 'Noche'];
                                          } else {
                                            const letters = rawOptions.split(',').map(l => l.trim()).filter(Boolean);
                                            if (letters.includes('M')) enabledTurnos.push('Mañana');
                                            if (letters.includes('T')) enabledTurnos.push('Tarde');
                                            if (letters.includes('N')) enabledTurnos.push('Noche');
                                          }
                                          return { id: s.id, turnosHabilitados: enabledTurnos };
                                        }).filter(s => s.turnosHabilitados.length > 0);

                                        const configCSP: ConfigCSP = {
                                          francos_mes_corto: Number(props.config.francos_mes_corto) || 6,
                                          francos_mes_largo: Number(props.config.francos_mes_largo) || 7,
                                          min_manana: Number(props.config.min_manana) || 0,
                                          max_manana: Number(props.config.max_manana) || 0,
                                          min_tarde: Number(props.config.min_tarde) || 0,
                                          max_tarde: Number(props.config.max_tarde) || 0,
                                          min_noche: Number(props.config.min_noche) || 2,
                                          max_noche: Number(props.config.max_noche) || 2,
                                        };

                                        const diasDelMesClient = diasDelMes.value;
                                        
                                        const cspResult = generarMatrizTurnos(staffMapped, configCSP, diasDelMesClient);
                                        
                                        const payloadAsignaciones: { staff_id: string, dia: string, turno: string }[] = [];
                                        // Filtrar los assignments base (preservar licencias/no francos)
                                        const newLocalAssigns: TurnoAsignado[] = [];
                                        const newLocalRules: ReglaDisponibilidad[] = [...localRules.value.filter(r => r.tipo !== 'Franco')];
                                        
                                        const targetMonthStr = `${props.anio}-${String(props.mes).padStart(2, '0')}`;

                                        for (const staffId in cspResult) {
                                          const schedule = cspResult[staffId];
                                          for (let dayIndex = 0; dayIndex < schedule.length && dayIndex < diasDelMesClient; dayIndex++) {
                                            const diaInt = dayIndex + 1;
                                            const dateString = `${targetMonthStr}-${String(diaInt).padStart(2, '0')}`;
                                            const rTurno = schedule[dayIndex];

                                            payloadAsignaciones.push({ staff_id: staffId, dia: dateString, turno: rTurno });
                                            if (rTurno === 'Franco') {
                                              newLocalRules.push({ fecha: dateString, tipo: 'Franco', staff_id: staffId } as any);
                                            } else if (rTurno !== 'Vacio') {
                                              newLocalAssigns.push({ dia: dateString, turno: rTurno, staff_id: staffId } as any);
                                            }
                                          }
                                        }

                                        // Estado optimista (asegura visualización antes del loader refetch)
                                        localAssignments.value = newLocalAssigns;
                                        localRules.value = newLocalRules;

                                        // La ejecución the saveGeneratedAction fuerza un refetch automático de QwikCity
                                        // sobre `props.assignments` que purgará sincronizadamente todos los loaders.
                                        props.saveGeneratedAction.submit({
                                          anio: props.anio,
                                          mes: props.mes,
                                          asignaciones: payloadAsignaciones
                                        });

                                    } catch (e: any) {
                                        engineErrorClientSide.value = e.message;
                                        console.error("Motor CSP Error:", e);
                                    } finally {
                                        isGeneratingClientSide.value = false;
                                    }
                                }}
                                disabled={isGeneratingClientSide.value || props.saveGeneratedAction.isRunning}
                                class="inline-flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isGeneratingClientSide.value || props.saveGeneratedAction.isRunning ? (
                                    <>
                                        <svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                        <span>Calculando cuadrante...</span>
                                    </>
                                ) : (
                                    <span>✨ Generar Mes Automáticamente</span>
                                )}
                            </button>
                            <button
                                onClick$={() => isEmptyStateDismissed.value = true}
                                class="inline-flex items-center justify-center px-6 py-3 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm transition-all"
                            >
                                Comenzar en blanco
                            </button>
                        </div>

                        {engineErrorClientSide.value && (
                            <div class="mt-6 p-3 bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 text-sm font-medium rounded-lg inline-block border border-rose-200 dark:border-rose-800 max-w-lg">
                                {engineErrorClientSide.value}
                            </div>
                        )}
                    </div>
                ) : (
                    <div id="roster-export-area" class="w-max min-w-full bg-white dark:bg-slate-900 p-2 transition-colors">
                        <table class="w-full text-left border-collapse text-sm">
                            <thead class="sticky top-0 z-30 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md shadow-[0_1px_0_0_rgba(203,213,225,1)] dark:shadow-[0_1px_0_0_rgba(51,65,85,1)] transition-colors">
                                <tr class="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    {/* Staff Column Header - Sticky Left */}
                                    <th class="px-4 py-3 border-r border-slate-200 dark:border-slate-800 sticky left-0 z-40 bg-slate-50 dark:bg-slate-800/90 shadow-[1px_0_0_0_rgba(203,213,225,1)] dark:shadow-[1px_0_0_0_rgba(51,65,85,1)] w-48 min-w-[12rem] transition-colors">
                                        Empleado
                                    </th>

                                    {/* Days Columns */}
                                    {daysData.value.map(day => (
                                        <th key={day.fechaString} class={`px-1 py-2 text-center border-r border-slate-200 dark:border-slate-800 min-w-[2.8rem] transition-colors ${day.isWeekend ? 'bg-indigo-50/50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400' : ''}`}>
                                            <div class="flex flex-col items-center justify-center h-full">
                                                <span class="text-[9px] text-slate-400 dark:text-slate-500 font-medium leading-tight">{day.nombreDia}</span>
                                                <span class="text-[13px] font-bold text-slate-700 dark:text-slate-300 leading-tight">{day.dia}</span>
                                            </div>
                                        </th>
                                    ))}

                                    {/* Francos Total Column - Sticky Right */}
                                    <th class="px-2 py-3 sticky right-0 z-40 bg-slate-50 dark:bg-slate-800/90 shadow-[-1px_0_0_0_rgba(203,213,225,1)] dark:shadow-[-1px_0_0_0_rgba(51,65,85,1)] text-center text-slate-600 dark:text-slate-400 w-16 select-none transition-colors" title={`Objetivo: ${targetFrancos.value} francos libres`}>
                                        Σ F. ({targetFrancos.value})
                                    </th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300 relative z-0 transition-colors">
                                {dataComputed.value.rows.map(row => (
                                    <tr key={row.staff.id} class="group hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors h-11">

                                        {/* Staff Name - Sticky Left */}
                                        <td class="px-4 py-1.5 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 group-hover:bg-slate-50/80 dark:group-hover:bg-slate-800/80 sticky left-0 z-20 shadow-[1px_0_0_0_rgba(241,245,249,1)] dark:shadow-[1px_0_0_0_rgba(30,41,59,1)] transition-colors">
                                            <div class="font-medium truncate text-slate-800 dark:text-slate-200 text-[13px]" title={row.staff.nombre}>{row.staff.nombre}</div>
                                        </td>

                                        {/* Interactive Cells ~40x40px */}
                                        {daysData.value.map(day => {
                                            const { state, isViolation } = row.cells[day.fechaString];
                                            return (
                                                <td key={`${row.staff.id}-${day.fechaString}`} class={`p-1 border-r border-slate-100 dark:border-slate-800 text-center align-middle transition-colors ${day.isWeekend ? 'bg-indigo-50/20 dark:bg-indigo-900/10' : ''}`}>
                                                    <button
                                                        onClick$={() => handleCellClick(row.staff.id, day.fechaString, state)}
                                                        class={`w-9 h-9 md:w-10 md:h-10 mx-auto text-[13px] flex items-center justify-center font-bold rounded-md transition-all cursor-pointer ${getCellColor(state, isViolation)}`}
                                                        title={`Asignar turno a ${row.staff.nombre} el ${day.dia}${isViolation ? ' (Infracción: Regla de 24hs de descanso)' : ''}`}
                                                        type="button"
                                                    >
                                                        {getCellLabel(state)}
                                                    </button>
                                                </td>
                                            )
                                        })}

                                        {/* Validación 1: Francos Totales - Sticky Right */}
                                        <td class="px-3 py-2 bg-white dark:bg-slate-900 group-hover:bg-slate-50/80 dark:group-hover:bg-slate-800/80 sticky right-0 z-20 shadow-[-1px_0_0_0_rgba(241,245,249,1)] dark:shadow-[-1px_0_0_0_rgba(30,41,59,1)] align-middle text-center w-16 transition-colors">
                                            <span class={`inline-block px-2 py-0.5 rounded text-xs font-bold font-mono ${row.francosCorrectos ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400' : 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-400'}`}>
                                                {row.francosTotales}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>

                            {/* FOOTER : Validación 2: Cobertura Diaria */}
                            <tfoot class="sticky bottom-0 z-30 bg-white dark:bg-slate-900 border-t border-slate-300 dark:border-slate-700 shadow-[0_-1px_3px_0_rgba(0,0,0,0.05)] transition-colors">
                                <tr class="tracking-tight border-b border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
                                    <th class="px-4 py-3 border-r border-slate-300 dark:border-slate-800 sticky left-0 z-40 bg-slate-100 dark:bg-slate-800/90 shadow-[1px_0_0_0_rgba(203,213,225,1)] dark:shadow-[1px_0_0_0_rgba(51,65,85,1)] text-md font-bold text-right text-slate-700 dark:text-slate-300 transition-colors">
                                        Cobertura Requerida
                                    </th>

                                    {daysData.value.map(day => {
                                        const totals = dataComputed.value.dailyTotals[day.fechaString];
                                        const mOk = totals.M >= props.config.min_manana && totals.M <= props.config.max_manana;
                                        const tOk = totals.T >= props.config.min_tarde && totals.T <= props.config.max_tarde;
                                        const nOk = totals.N >= props.config.min_noche && totals.N <= props.config.max_noche;

                                        return (
                                            <td key={`footer-${day.fechaString}`} class="p-1 px-1.5 border-r border-slate-200 dark:border-slate-800 text-center bg-slate-50/80 dark:bg-slate-800/80 backdrop-blur align-middle transition-colors">
                                                <div class="flex flex-col items-center justify-center gap-1 text-md font-mono leading-none font-semibold">
                                                    <span class={`w-full text-center rounded-sm py-0.5 px-1 ${mOk ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400" : "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-400"}`}>M:{totals.M}</span>
                                                    <span class={`w-full text-center rounded-sm py-0.5 px-1 ${tOk ? "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400" : "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-400"}`}>T:{totals.T}</span>
                                                    <span class={`w-full text-center rounded-sm py-0.5 px-1 ${nOk ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400" : "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-400"}`}>N:{totals.N}</span>
                                                </div>
                                            </td>
                                        )
                                    })}

                                    <th class="px-3 py-2 sticky right-0 z-40 bg-slate-100 dark:bg-slate-800/90 border-l border-slate-300 dark:border-slate-800 shadow-[-1px_0_0_0_rgba(203,213,225,1)] dark:shadow-[-1px_0_0_0_rgba(51,65,85,1)] text-center text-xs text-slate-500 font-medium transition-colors"></th>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>

            {/* ERROR DE INFRACCIÓN GLOBAL EN LA PARTE INFERIOR */}
            {(hasViolations.value.hasRestViolations || hasViolations.value.hasFrancoViolations) && (
                <div class="px-5 py-3 bg-rose-50 dark:bg-rose-950/50 border-t border-rose-200 dark:border-rose-900 z-40 relative shadow-inner transition-colors">
                    <div class="flex flex-col gap-1 max-w-[1200px] mx-auto text-sm text-rose-700 dark:text-rose-400">
                        {hasViolations.value.hasRestViolations && (
                            <p class="flex items-center justify-center md:justify-start gap-2">
                                <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                                <strong>Regla de Descanso:</strong> Existen celdas marcadas que violan la regla de 24hs entre turnos (Noche ➝ Mañana/Tarde, o Tarde ➝ Mañana).
                            </p>
                        )}
                        {hasViolations.value.hasFrancoViolations && (
                            <p class="flex items-center justify-center md:justify-start gap-2">
                                <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                                <strong>Regla de Francos:</strong> Hay personal que no cumple el cupo mensual exácto ({targetFrancos.value} francos obligatorios para un mes de {diasDelMes.value} días).
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
});
