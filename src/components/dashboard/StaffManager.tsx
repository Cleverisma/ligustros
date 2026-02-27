import { component$, $ } from '@builder.io/qwik';
import { Form } from '@builder.io/qwik-city';
import type { ActionStore } from '@builder.io/qwik-city';

interface StaffManagerProps {
    staffList: Array<{ id: string; nombre: string; rol: string; }>;
    manageAction: ActionStore<any, any, true>;
}

export const StaffManager = component$<StaffManagerProps>((props) => {

    // Función helper estática para el color del badge basado en el string "rol"
    const getBadgeStyle = (rol: string) => {
        const rolNormalizado = (rol || '').toLowerCase().trim();
        if (rolNormalizado.includes('enfermeri') || rolNormalizado.includes('enfermera') || rolNormalizado.includes('medico')) {
            return "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/50";
        }
        if (rolNormalizado.includes('maestranza') || rolNormalizado.includes('limpieza') || rolNormalizado.includes('mantenimiento')) {
            return "bg-orange-100 dark:bg-orange-900/50 text-orange-800 dark:text-orange-300 border-orange-200 dark:border-orange-800/50";
        }
        if (rolNormalizado.includes('cocin')) {
            return "bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800/50";
        }
        return "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700"; // Default
    };

    return (
        <div class="bg-white dark:bg-slate-900 flex flex-col h-full overflow-hidden transition-colors">
            <div class="px-6 py-5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex justify-between items-center shrink-0 pr-12 transition-colors">
                <h2 class="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Gestión de Staff</h2>
            </div>

            <div class="p-0 flex-1 flex flex-col min-h-0">
                {/* Lista de Empleados */}
                <div class="flex-1 overflow-y-auto">
                    {props.staffList.length === 0 ? (
                        <div class="flex flex-col items-center justify-center p-12 text-center h-full">
                            <div class="w-16 h-16 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4 border border-slate-200 dark:border-slate-700 shadow-sm">
                                <svg class="w-8 h-8 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path>
                                </svg>
                            </div>
                            <h3 class="text-base font-semibold text-slate-900 dark:text-slate-100">Directorio Vacío</h3>
                            <p class="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-[200px]">Comienza agregando miembros al staff para autogenerar turnos.</p>
                        </div>
                    ) : (
                        <ul class="divide-y divide-slate-100 dark:divide-slate-800">
                            {props.staffList.map((empleado) => (
                                <li key={empleado.id} class="px-6 py-4 flex flex-col xl:flex-row justify-between xl:items-center gap-3 group hover:bg-slate-50/80 dark:hover:bg-slate-800/80 transition-colors">
                                    <div class="flex-1 min-w-0">
                                        <p class="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100 truncate">
                                            {empleado.nombre}
                                        </p>
                                        <div class="mt-1.5 flex items-center">
                                            <span class={`inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-medium border ${getBadgeStyle(empleado.rol)} capitalize tracking-wide`}>
                                                {empleado.rol || 'General'}
                                            </span>
                                        </div>
                                    </div>
                                    <Form action={props.manageAction} class="shrink-0 xl:opacity-0 xl:group-hover:opacity-100 transition-opacity">
                                        <input type="hidden" name="action" value="remove" />
                                        <input type="hidden" name="id" value={empleado.id} />
                                        <button
                                            type="submit"
                                            class="inline-flex items-center justify-center p-2 text-red-500 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 bg-white dark:bg-slate-800 border border-transparent rounded-lg transition-colors text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-red-500"
                                            title="Remover Empleado"
                                            onClick$={$((e: Event) => {
                                                if (!window.confirm(`¿Estás seguro de que quieres eliminar a ${empleado.nombre}?`)) {
                                                    e.preventDefault();
                                                }
                                            })}
                                        >
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                        </button>
                                    </Form>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {/* Formulario de Alta */}
                <div class="p-6 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 shrink-0 transition-colors">
                    <h3 class="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-4 flex items-center gap-2">
                        <span>Agregar Miembro</span>
                    </h3>
                    <Form action={props.manageAction} class="space-y-4">
                        <input type="hidden" name="action" value="add" />

                        <div class="space-y-4">
                            <div>
                                <label for="nombre" class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wide">Nombre Completo</label>
                                <input
                                    type="text"
                                    id="nombre"
                                    name="nombre"
                                    required
                                    class="w-full rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-sm transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500"
                                    placeholder="Ej: María López"
                                />
                            </div>
                            <div>
                                <label for="rol" class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wide">Rol / Especialidad</label>
                                <input
                                    type="text"
                                    id="rol"
                                    name="rol"
                                    class="w-full rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-sm transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500"
                                    placeholder="Ej: Enfermería o Franquero"
                                />
                            </div>
                        </div>

                        <div class="pt-2">
                            <button
                                type="submit"
                                disabled={props.manageAction.isRunning}
                                class="w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                            >
                                {props.manageAction.isRunning ? (
                                    <>
                                        <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Guardando...
                                    </>
                                ) : 'Guardar Empleado'}
                            </button>
                        </div>

                        {props.manageAction.value?.success && (
                            <div class="p-3 bg-emerald-50 rounded-lg border border-emerald-100 mt-3 text-center">
                                <p class="text-emerald-700 text-xs font-medium">{props.manageAction.value.message}</p>
                            </div>
                        )}
                        {props.manageAction.value?.failed && (
                            <div class="p-3 bg-red-50 rounded-lg border border-red-100 mt-3 text-center">
                                <p class="text-red-700 text-xs font-medium">{props.manageAction.value.message}</p>
                            </div>
                        )}
                    </Form>
                </div>
            </div>
        </div>
    );
});
