import { component$, useSignal, useComputed$ } from '@builder.io/qwik';
import { routeLoader$, type DocumentHead } from '@builder.io/qwik-city';
import { getDbClient } from '../../server/db/turso';
import type { Staff, TurnoAsignado, ReglaDisponibilidad } from '../../types';

// Loaders: Fetch data for the current month (or provided by URL params)
export const useStaffLoader = routeLoader$(async (requestEvent) => {
    const db = getDbClient(requestEvent.env);
    const result = await db.execute('SELECT * FROM staff ORDER BY nombre ASC');
    return result.rows as unknown as Staff[];
});

export const useMobileScheduleLoader = routeLoader$(async (requestEvent) => {
    const db = getDbClient(requestEvent.env);
    const url = requestEvent.url;
    const mesParam = url.searchParams.get('mes');
    const anioParam = url.searchParams.get('anio');

    const hoy = new Date();
    const anio = anioParam ? parseInt(anioParam) : hoy.getFullYear();
    const mes = mesParam ? parseInt(mesParam) : hoy.getMonth() + 1;
    const targetMonthStr = `${anio}-${String(mes).padStart(2, '0')}`;

    // Use a batch query for performance
    const results = await db.batch([
        {
            sql: `SELECT * FROM turnos_asignados WHERE strftime('%Y-%m', dia) = ? ORDER BY dia ASC`,
            args: [targetMonthStr]
        },
        {
            sql: `SELECT * FROM reglas_disponibilidad WHERE strftime('%Y-%m', fecha) = ? AND tipo = 'Franco' ORDER BY fecha ASC`,
            args: [targetMonthStr]
        }
    ]);

    return {
        turnos: results[0].rows as unknown as TurnoAsignado[],
        francos: results[1].rows as unknown as ReglaDisponibilidad[],
        anio,
        mes
    };
});

export default component$(() => {
    const staff = useStaffLoader();
    const scheduleData = useMobileScheduleLoader();

    // Selected staff ID state
    const selectedStaffId = useSignal('');

    // Combined and filtered chronological events for the selected user
    const userEvents = useComputed$(() => {
        if (!selectedStaffId.value) return [];

        const { turnos, francos } = scheduleData.value;

        // Filter by staff
        const userTurnos = turnos.filter(t => t.staff_id === selectedStaffId.value);
        const userFrancos = francos.filter(f => f.staff_id === selectedStaffId.value);

        // Normalize and combine into a single array
        const events: Array<{ fechaString: string, fechaObj: Date, tipo: string }> = [];

        userTurnos.forEach(t => {
            // Create date object taking local timezone adjustments into account
            const [year, month, day] = t.dia.split('-').map(Number);
            events.push({
                fechaString: t.dia,
                fechaObj: new Date(year, month - 1, day),
                tipo: t.turno // "Mañana", "Tarde", "Noche"
            });
        });

        userFrancos.forEach(f => {
            const [year, month, day] = f.fecha.split('-').map(Number);
            events.push({
                fechaString: f.fecha,
                fechaObj: new Date(year, month - 1, day),
                tipo: 'Franco'
            });
        });

        // Sort chronologically
        return events.sort((a, b) => a.fechaObj.getTime() - b.fechaObj.getTime());
    });

    // Helper to format Date -> "Lunes 15"
    const formatEventDate = (date: Date) => {
        const formatter = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric' });
        const formatted = formatter.format(date);
        // Capitalize first letter
        return formatted.charAt(0).toUpperCase() + formatted.slice(1);
    };

    // Helper to get semantic colors for each shift type
    const getSemanticColors = (tipo: string) => {
        switch (tipo) {
            case 'Mañana':
                return { border: 'border-blue-500 dark:border-blue-700', bg: 'bg-blue-50 dark:bg-blue-900/40', text: 'text-blue-800 dark:text-blue-300', dot: 'bg-blue-500 dark:bg-blue-400' };
            case 'Tarde':
                return { border: 'border-orange-500 dark:border-orange-700', bg: 'bg-orange-50 dark:bg-orange-900/40', text: 'text-orange-800 dark:text-orange-300', dot: 'bg-orange-500 dark:bg-orange-400' };
            case 'Noche':
                return { border: 'border-purple-500 dark:border-purple-700', bg: 'bg-purple-50 dark:bg-purple-900/40', text: 'text-purple-800 dark:text-purple-300', dot: 'bg-purple-500 dark:bg-purple-400' };
            case 'Franco':
                return { border: 'border-emerald-500 dark:border-emerald-700', bg: 'bg-emerald-50 dark:bg-emerald-900/40', text: 'text-emerald-800 dark:text-emerald-300', dot: 'bg-emerald-500 dark:bg-emerald-400' };
            default:
                return { border: 'border-slate-400 dark:border-slate-600', bg: 'bg-slate-50 dark:bg-slate-800/50', text: 'text-slate-800 dark:text-slate-300', dot: 'bg-slate-400 dark:bg-slate-500' };
        }
    };

    const nombreMes = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(new Date(scheduleData.value.anio, scheduleData.value.mes - 1, 1));

    return (
        <div class="min-h-screen bg-slate-50 dark:bg-slate-900 font-sans pb-10 transition-colors">
            {/* Mobile-first Header */}
            <header class="bg-indigo-600 dark:bg-indigo-900 px-6 py-8 text-white shadow-lg sticky top-0 z-20 transition-colors">
                <h1 class="text-3xl font-extrabold tracking-tight mb-2">Ligustros Sync</h1>
                <p class="text-indigo-100 dark:text-indigo-200 font-medium opacity-90">Mi Cronograma de Turnos</p>
            </header>

            <main class="max-w-md mx-auto px-4 -mt-6 relative z-30">
                {/* Selector Card */}
                <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 mb-8 border border-slate-100 dark:border-slate-700 transition-colors">
                    <label for="staff-select" class="block text-sm font-bold text-slate-700 dark:text-slate-200 mb-3 uppercase tracking-wide">
                        ¿Quién eres?
                    </label>
                    <div class="relative">
                        <select
                            id="staff-select"
                            class="block w-full appearance-none rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 px-4 py-4 text-slate-800 dark:text-slate-100 font-medium shadow-sm transition-colors focus:border-indigo-500 dark:focus:border-indigo-400 focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 dark:focus:ring-indigo-500/20 text-lg"
                            value={selectedStaffId.value}
                            onChange$={(e) => {
                                const target = e.target as HTMLSelectElement;
                                selectedStaffId.value = target.value;
                            }}
                        >
                            <option value="" disabled selected>Selecciona tu nombre...</option>
                            {staff.value.map(s => (
                                <option key={s.id} value={s.id}>{s.nombre}</option>
                            ))}
                        </select>
                        <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-500 dark:text-slate-400">
                            <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                        </div>
                    </div>
                </div>

                {/* Content Area */}
                {!selectedStaffId.value ? (
                    <div class="text-center py-12 px-6">
                        <div class="w-20 h-20 bg-indigo-100 dark:bg-indigo-900/50 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
                            <span class="text-4xl text-indigo-500 dark:text-indigo-400">👋</span>
                        </div>
                        <h3 class="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">¡Hola!</h3>
                        <p class="text-slate-500 dark:text-slate-400 text-base leading-relaxed">
                            Selecciona tu nombre en la lista de arriba para ver los turnos y francos que tienes asignados para <strong>{nombreMes}</strong>.
                        </p>
                    </div>
                ) : (
                    <div class="space-y-6 animate-fade-in">
                        <div class="flex items-center justify-between mb-2">
                            <h2 class="text-lg font-extrabold text-slate-800 dark:text-slate-100 capitalize tracking-tight">{nombreMes}</h2>
                            <span class="bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs px-2.5 py-1 rounded-full font-bold shadow-sm inline-flex items-center gap-1.5 transition-colors">
                                Σ {userEvents.value.length} event.
                            </span>
                        </div>

                        {userEvents.value.length === 0 ? (
                            <div class="bg-amber-50 dark:bg-amber-900/20 rounded-2xl p-6 border-2 border-amber-200 dark:border-amber-800/50 text-center">
                                <p class="text-amber-800 dark:text-amber-400 font-medium">Aún no tienes turnos ni francos asignados para este mes.</p>
                            </div>
                        ) : (
                            <div class="relative border-l-4 border-slate-200 dark:border-slate-700 ml-4 space-y-8 pl-6 pb-4">
                                {userEvents.value.map((event, index) => {
                                    const colors = getSemanticColors(event.tipo);
                                    return (
                                        <div key={index} class="relative">
                                            {/* Timeline Dot */}
                                            <span class={`absolute -left-[35px] top-4 w-4 h-4 rounded-full ${colors.dot} ring-4 ring-slate-50 dark:ring-slate-900 shadow-sm z-10`}></span>

                                            {/* Event Card */}
                                            <div class={`bg-white dark:bg-slate-800 rounded-xl shadow-md border-l-4 ${colors.border} p-4 transition-transform hover:scale-[1.02]`}>
                                                <div class="flex items-center justify-between">
                                                    <h3 class="text-lg font-bold text-slate-900 dark:text-slate-100 leading-none">
                                                        {formatEventDate(event.fechaObj)}
                                                    </h3>
                                                    <span class={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${colors.bg} ${colors.text}`}>
                                                        {event.tipo}
                                                    </span>
                                                </div>
                                                <div class="mt-2 text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                                    <span class="font-mono text-xs">{event.fechaString}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <div class="pt-8 pb-4 text-center">
                            <p class="text-xs text-slate-400 font-medium">Generado automáticamente por Ligustros Sync</p>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
});

export const head: DocumentHead = {
    title: 'Mis Turnos | Ligustros Sync',
    meta: [
        {
            name: 'description',
            content: 'Revisa tu cronograma de turnos y francos.',
        },
        {
            name: 'viewport',
            content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0'
        }
    ],
};
