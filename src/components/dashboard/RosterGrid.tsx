import { component$, useComputed$, $, useSignal, useTask$ } from '@builder.io/qwik';
import type { ActionStore } from '@builder.io/qwik-city';
import type { TurnoAsignado, Staff, ReglaDisponibilidad } from '../../types';

interface RosterGridProps {
    assignments: TurnoAsignado[];
    rules: ReglaDisponibilidad[];
    staffList: Staff[];
    anio: number;
    mes: number;
    toggleAction: ActionStore<any, any, true>;
}

export const RosterGrid = component$<RosterGridProps>((props) => {

    // ESTADO OPTIMISTA (Latencia Cero)
    // Sincronizamos las props del servidor en signals locales.
    // Cuando el Action de Qwik redibuja con nuevos props tras el submit, 
    // el useTask$ absorbe los cambios garantizando una fuente de verdad única sin lag.
    const localAssignments = useSignal([...props.assignments]);
    const localRules = useSignal([...props.rules]);

    useTask$(({ track }) => {
        const serverAssigns = track(() => props.assignments);
        const serverRules = track(() => props.rules);
        localAssignments.value = [...serverAssigns];
        localRules.value = [...serverRules];
    });

    const diasDelMes = new Date(props.anio, props.mes, 0).getDate();
    // Objetivo de francos dinámico: 6 para meses de 30 días, 7 para meses de 31
    const targetFrancos = diasDelMes === 31 ? 7 : 6;

    // Configuración de los días del mes
    const daysData = useComputed$(() => {
        const days = [];
        for (let dia = 1; dia <= diasDelMes; dia++) {
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
        const rows = props.staffList.map(staffMember => {
            const francosCount = rules.filter(r => r.staff_id === staffMember.id && r.tipo === 'Franco').length;

            const cellData: Record<string, { state: string; isViolation: boolean }> = {};

            for (let dia = 1; dia <= diasDelMes; dia++) {
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
                francosCorrectos: francosCount === targetFrancos, // Validación 1
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
        const hasFrancoViolations = dataComputed.value.rows.some(r => !r.francosCorrectos);
        return { hasRestViolations, hasFrancoViolations };
    });

    // Acción Optimista -> Ciclar estado
    const handleCellClick = $((staffId: string, fecha: string, currentState: string) => {
        const sequence = ['Vacío', 'Mañana', 'Tarde', 'Noche', 'Franco'];
        const currentIndex = sequence.indexOf(currentState);
        const nextState = sequence[(currentIndex + 1) % sequence.length];

        // Múltiples mutaciones síncronas para respuesta <1ms en UI
        localAssignments.value = localAssignments.value.filter(a => !(a.staff_id === staffId && a.dia === fecha));
        localRules.value = localRules.value.filter(r => !(r.staff_id === staffId && r.fecha === fecha));

        if (nextState !== 'Vacío' && nextState !== 'Franco') {
            localAssignments.value = [...localAssignments.value, { dia: fecha, turno: nextState as any, staff_id: staffId }];
        } else if (nextState === 'Franco') {
            localRules.value = [...localRules.value, { fecha, tipo: 'Franco', staff_id: staffId }];
        }

        // Llamada asíncrona real a la BD
        props.toggleAction.submit({
            staff_id: staffId,
            fecha: fecha,
            tipo_asignacion: nextState
        });
    });

    const getCellColor = (state: string, isViolation: boolean) => {
        const base = isViolation
            ? 'ring-2 ring-rose-500 ring-inset shadow-[0_0_8px_rgba(244,63,94,0.4)] z-10 relative '
            : '';

        switch (state) {
            case 'Mañana': return base + 'bg-emerald-100/90 text-emerald-800 hover:bg-emerald-200 border-emerald-200';
            case 'Tarde': return base + 'bg-orange-100/90 text-orange-800 hover:bg-orange-200 border-orange-200';
            case 'Noche': return base + 'bg-indigo-100/90 text-indigo-800 hover:bg-indigo-200 border-indigo-200';
            case 'Franco': return base + 'bg-zinc-200/80 text-zinc-600 hover:bg-zinc-300 border-zinc-300 font-medium';
            default: return base + 'bg-transparent text-slate-300 hover:bg-slate-100 border-transparent';
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
        <div class="flex flex-col h-full bg-white">
            {/* Cabecera / Leyenda */}
            <div class="px-5 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center shrink-0">
                <h2 class="font-bold text-slate-900 tracking-tight flex items-center gap-2">
                    <svg class="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                    Planilla de Asignación <span class="text-slate-500 font-medium ml-2">| {new Intl.DateTimeFormat('es-AR', { month: 'short', year: 'numeric' }).format(new Date(props.anio, props.mes - 1, 1)).toUpperCase()}</span>
                </h2>
                <div class="flex flex-wrap gap-4 text-xs font-semibold text-slate-600 uppercase tracking-widest">
                    <span class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-sm bg-emerald-100 border border-emerald-200"></div> Mañana (5-6)</span>
                    <span class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-sm bg-orange-100 border border-orange-200"></div> Tarde (5-6)</span>
                    <span class="flex items-center gap-1.5"><div class="w-3 h-3 rounded-sm bg-indigo-100 border border-indigo-200"></div> Noche (2)</span>
                    <span class="flex items-center gap-1.5 text-rose-600"><div class="w-3 h-3 rounded-sm border-2 border-rose-500"></div> Descanso &lt; 24h</span>
                </div>
            </div>

            <div class="overflow-x-auto overflow-y-auto w-full custom-scrollbar flex-1 relative bg-white">
                <table class="w-max min-w-full text-left border-collapse text-sm">
                    <thead class="sticky top-0 z-30 bg-white/90 backdrop-blur-md shadow-[0_1px_0_0_rgba(203,213,225,1)]">
                        <tr class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                            {/* Staff Column Header - Sticky Left */}
                            <th class="px-4 py-3 border-r border-slate-200 sticky left-0 z-40 bg-slate-50 shadow-[1px_0_0_0_rgba(203,213,225,1)] w-48 min-w-[12rem]">
                                Empleado
                            </th>

                            {/* Days Columns */}
                            {daysData.value.map(day => (
                                <th key={day.fechaString} class={`px-1 py-2 text-center border-r border-slate-200 min-w-[2.8rem] ${day.isWeekend ? 'bg-indigo-50/50 text-indigo-700' : ''}`}>
                                    <div class="flex flex-col items-center justify-center h-full">
                                        <span class="text-[9px] text-slate-400 font-medium leading-tight">{day.nombreDia}</span>
                                        <span class="text-[13px] font-bold text-slate-700 leading-tight">{day.dia}</span>
                                    </div>
                                </th>
                            ))}

                            {/* Francos Total Column - Sticky Right */}
                            <th class="px-2 py-3 sticky right-0 z-40 bg-slate-50 shadow-[-1px_0_0_0_rgba(203,213,225,1)] text-center text-slate-600 w-16 select-none" title={`Objetivo: ${targetFrancos} francos libres`}>
                                Σ F. ({targetFrancos})
                            </th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 text-slate-700 relative z-0">
                        {dataComputed.value.rows.map(row => (
                            <tr key={row.staff.id} class="group hover:bg-slate-50/50 transition-colors h-11">

                                {/* Staff Name - Sticky Left */}
                                <td class="px-4 py-1.5 border-r border-slate-200 bg-white group-hover:bg-slate-50/80 sticky left-0 z-20 shadow-[1px_0_0_0_rgba(241,245,249,1)]">
                                    <div class="font-medium truncate text-slate-800 text-[13px]" title={row.staff.nombre}>{row.staff.nombre}</div>
                                </td>

                                {/* Interactive Cells ~40x40px */}
                                {daysData.value.map(day => {
                                    const { state, isViolation } = row.cells[day.fechaString];
                                    return (
                                        <td key={`${row.staff.id}-${day.fechaString}`} class={`p-1 border-r border-slate-100 text-center align-middle ${day.isWeekend ? 'bg-indigo-50/20' : ''}`}>
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
                                <td class="px-3 py-2 bg-white group-hover:bg-slate-50/80 sticky right-0 z-20 shadow-[-1px_0_0_0_rgba(241,245,249,1)] align-middle text-center w-16">
                                    <span class={`inline-block px-2 py-0.5 rounded text-xs font-bold font-mono ${row.francosCorrectos ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                        {row.francosTotales}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>

                    {/* FOOTER : Validación 2: Cobertura Diaria */}
                    <tfoot class="sticky bottom-0 z-30 bg-white border-t border-slate-300 shadow-[0_-1px_3px_0_rgba(0,0,0,0.05)]">
                        <tr class="tracking-tight border-b border-slate-200 shadow-sm">
                            <th class="px-4 py-3 border-r border-slate-300 sticky left-0 z-40 bg-slate-100 shadow-[1px_0_0_0_rgba(203,213,225,1)] text-xs font-bold text-right text-slate-700">
                                Cobertura Requerida
                            </th>

                            {daysData.value.map(day => {
                                const totals = dataComputed.value.dailyTotals[day.fechaString];
                                const mOk = totals.M >= 5 && totals.M <= 6;
                                const tOk = totals.T >= 5 && totals.T <= 6;
                                const nOk = totals.N === 2;

                                return (
                                    <td key={`footer-${day.fechaString}`} class="p-1 px-1.5 border-r border-slate-200 text-center bg-slate-50/80 backdrop-blur align-middle">
                                        <div class="flex flex-col items-center justify-center gap-1 text-[10px] font-mono leading-none font-semibold">
                                            <span class={`w-full text-center rounded-sm py-0.5 px-1 ${mOk ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>M:{totals.M}</span>
                                            <span class={`w-full text-center rounded-sm py-0.5 px-1 ${tOk ? "bg-orange-100 text-orange-700" : "bg-rose-100 text-rose-700"}`}>T:{totals.T}</span>
                                            <span class={`w-full text-center rounded-sm py-0.5 px-1 ${nOk ? "bg-indigo-100 text-indigo-700" : "bg-rose-100 text-rose-700"}`}>N:{totals.N}</span>
                                        </div>
                                    </td>
                                )
                            })}

                            <th class="px-3 py-2 sticky right-0 z-40 bg-slate-100 border-l border-slate-300 shadow-[-1px_0_0_0_rgba(203,213,225,1)] text-center text-xs text-slate-500 font-medium"></th>
                        </tr>
                    </tfoot>
                </table>
            </div>

            {/* ERROR DE INFRACCIÓN GLOBAL EN LA PARTE INFERIOR */}
            {(hasViolations.value.hasRestViolations || hasViolations.value.hasFrancoViolations) && (
                <div class="px-5 py-3 bg-rose-50 border-t border-rose-200 z-40 relative shadow-inner">
                    <div class="flex flex-col gap-1 max-w-[1200px] mx-auto text-sm text-rose-700">
                        {hasViolations.value.hasRestViolations && (
                            <p class="flex items-center justify-center md:justify-start gap-2">
                                <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                                <strong>Regla de Descanso:</strong> Existen celdas marcadas que violan la regla de 24hs entre turnos (Noche ➝ Mañana/Tarde, o Tarde ➝ Mañana).
                            </p>
                        )}
                        {hasViolations.value.hasFrancoViolations && (
                            <p class="flex items-center justify-center md:justify-start gap-2">
                                <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                                <strong>Regla de Francos:</strong> Hay personal que no cumple el cupo mensual exácto ({targetFrancos} francos obligatorios para un mes de {diasDelMes} días).
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
});
