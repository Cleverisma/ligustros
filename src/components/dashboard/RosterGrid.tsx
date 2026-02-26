import { component$, useComputed$ } from '@builder.io/qwik';
import type { TurnoAsignado, Staff } from '../../utils/scheduler/generarCuadrante';

interface RosterGridProps {
    assignments: TurnoAsignado[];
    staffList: Staff[];
    anio: number;
    mes: number;
}

export const RosterGrid = component$<RosterGridProps>((props) => {
    const gridData = useComputed$(() => {
        // Generate empty structure for the month
        const diasDelMes = new Date(props.anio, props.mes, 0).getDate();
        const rows = [];

        // Create map for fast lookup
        const staffMap = new Map(props.staffList.map(s => [s.id, s.nombre]));

        for (let dia = 1; dia <= diasDelMes; dia++) {
            const diaString = `${props.anio}-${String(props.mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

            const turnosDelDia = props.assignments.filter(a => a.dia === diaString);
            const getStaffForTurno = (turnoNombre: string) => {
                const turno = turnosDelDia.find(t => t.turno === turnoNombre);
                if (!turno) return null;
                return staffMap.get(turno.staff_id) || 'Empleado no encontrado';
            };

            // Format date for display
            const fecha = new Date(props.anio, props.mes - 1, dia);
            const nombreDia = new Intl.DateTimeFormat('es-AR', { weekday: 'short' }).format(fecha);

            rows.push({
                diaStr: diaString,
                diaDisplay: `${nombreDia} ${dia}`,
                isWeekend: fecha.getDay() === 0 || fecha.getDay() === 6,
                manana: getStaffForTurno('Mañana'),
                tarde: getStaffForTurno('Tarde'),
                noche: getStaffForTurno('Noche')
            });
        }
        return rows;
    });

    return (
        <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-full">
            <div class="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <h2 class="text-xl font-semibold text-slate-800">
                    Cuadrante de Turnos - {new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(new Date(props.anio, props.mes - 1, 1))}
                </h2>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="bg-slate-50 border-b border-slate-200 text-sm uppercase tracking-wider text-slate-500">
                            <th class="px-6 py-3 font-medium">Día</th>
                            <th class="px-6 py-3 font-medium">Mañana</th>
                            <th class="px-6 py-3 font-medium">Tarde</th>
                            <th class="px-6 py-3 font-medium border-l border-slate-200">Noche</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 text-sm">
                        {gridData.value.map((row) => (
                            <tr key={row.diaStr} class={`hover:bg-blue-50/50 transition-colors ${row.isWeekend ? 'bg-slate-50/50' : ''}`}>
                                <td class="px-6 py-3 font-medium text-slate-700 whitespace-nowrap">
                                    <span class={`capitalize ${row.isWeekend ? 'text-blue-600' : ''}`}>{row.diaDisplay}</span>
                                </td>
                                <td class="px-6 py-3">
                                    {row.manana ? (
                                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                                            {row.manana}
                                        </span>
                                    ) : (
                                        <span class="text-slate-400 italic text-xs">Sin asignar</span>
                                    )}
                                </td>
                                <td class="px-6 py-3">
                                    {row.tarde ? (
                                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                                            {row.tarde}
                                        </span>
                                    ) : (
                                        <span class="text-slate-400 italic text-xs">Sin asignar</span>
                                    )}
                                </td>
                                <td class="px-6 py-3 border-l border-slate-100">
                                    {row.noche ? (
                                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                                            {row.noche}
                                        </span>
                                    ) : (
                                        <span class="text-slate-400 italic text-xs">Sin asignar</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
});
