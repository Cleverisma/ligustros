import { component$ } from '@builder.io/qwik';
import { Form } from '@builder.io/qwik-city';
import type { ActionStore } from '@builder.io/qwik-city';

interface StaffManagerProps {
    staffList: Array<{ id: string; nombre: string; rol: string; }>;
    manageAction: ActionStore<any, any, true>;
}

export const StaffManager = component$<StaffManagerProps>((props) => {
    return (
        <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div class="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <h2 class="text-xl font-semibold text-slate-800">Gestión de Staff</h2>
            </div>

            <div class="p-6">
                {/* Lista de Empleados */}
                <div class="mb-8">
                    <ul class="divide-y divide-slate-100">
                        {props.staffList.length === 0 ? (
                            <li class="py-4 text-slate-500 text-sm italic">No hay empleados registrados.</li>
                        ) : (
                            props.staffList.map((empleado) => (
                                <li key={empleado.id} class="py-3 flex justify-between items-center group">
                                    <div>
                                        <p class="font-medium text-slate-800">{empleado.nombre}</p>
                                        <p class="text-sm text-slate-500">{empleado.rol || 'Sin rol específico'}</p>
                                    </div>
                                    <Form action={props.manageAction}>
                                        <input type="hidden" name="action" value="remove" />
                                        <input type="hidden" name="id" value={empleado.id} />
                                        <button
                                            type="submit"
                                            class="text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1 bg-transparent rounded-md transition-colors text-sm"
                                        >
                                            Eliminar
                                        </button>
                                    </Form>
                                </li>
                            ))
                        )}
                    </ul>
                </div>

                {/* Formulario de Alta */}
                <div class="pt-6 border-t border-slate-100">
                    <h3 class="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-4">Agregar Nuevo Empleado</h3>
                    <Form action={props.manageAction} class="space-y-4">
                        <input type="hidden" name="action" value="add" />

                        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                                <label for="nombre" class="block text-sm font-medium text-slate-700 mb-1">Nombre Completo</label>
                                <input
                                    type="text"
                                    id="nombre"
                                    name="nombre"
                                    required
                                    class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="Ej: María López"
                                />
                            </div>
                            <div>
                                <label for="rol" class="block text-sm font-medium text-slate-700 mb-1">Rol / Puesto</label>
                                <input
                                    type="text"
                                    id="rol"
                                    name="rol"
                                    class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="Ej: Enfermera de Planta"
                                />
                            </div>
                        </div>

                        <div class="flex justify-end">
                            <button
                                type="submit"
                                class="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors text-sm font-medium"
                            >
                                Agregar Empleado
                            </button>
                        </div>

                        {props.manageAction.value?.success && (
                            <p class="text-green-600 text-sm mt-2">{props.manageAction.value.message}</p>
                        )}
                        {props.manageAction.value?.failed && (
                            <p class="text-red-600 text-sm mt-2">{props.manageAction.value.message}</p>
                        )}
                    </Form>
                </div>
            </div>
        </div>
    );
});
