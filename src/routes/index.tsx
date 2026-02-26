import { component$, useSignal } from '@builder.io/qwik';
import { routeLoader$, globalAction$, zod$, z, type DocumentHead, useLocation, Link } from '@builder.io/qwik-city';
import { getDbClient } from '../server/db/turso';
import { StaffManager } from '../components/dashboard/StaffManager';
import { RosterGrid } from '../components/dashboard/RosterGrid';
import type { Staff, TurnoAsignado, ReglaDisponibilidad } from '../types';

// --- LOADERS ---
export const useStaffLoader = routeLoader$(async (requestEvent) => {
  const db = getDbClient(requestEvent.env);
  const result = await db.execute('SELECT * FROM staff ORDER BY nombre ASC');
  return result.rows as unknown as Staff[];
});

export const useAssignmentsLoader = routeLoader$(async (requestEvent) => {
  const db = getDbClient(requestEvent.env);
  const url = requestEvent.url;
  const mesParam = url.searchParams.get('mes');
  const anioParam = url.searchParams.get('anio');

  const hoy = new Date();
  const anio = anioParam ? parseInt(anioParam) : hoy.getFullYear();
  const mes = mesParam ? parseInt(mesParam) : hoy.getMonth() + 1;
  const targetMonthStr = `${anio}-${String(mes).padStart(2, '0')}`;

  const result = await db.execute({
    sql: `
      SELECT * FROM turnos_asignados 
      WHERE strftime('%Y-%m', dia) = ? 
      ORDER BY dia ASC
    `,
    args: [targetMonthStr]
  });
  return result.rows as unknown as TurnoAsignado[];
});

export const useRulesLoader = routeLoader$(async (requestEvent) => {
  const db = getDbClient(requestEvent.env);
  const url = requestEvent.url;
  const mesParam = url.searchParams.get('mes');
  const anioParam = url.searchParams.get('anio');

  const hoy = new Date();
  const anio = anioParam ? parseInt(anioParam) : hoy.getFullYear();
  const mes = mesParam ? parseInt(mesParam) : hoy.getMonth() + 1;
  const targetMonthStr = `${anio}-${String(mes).padStart(2, '0')}`;

  const result = await db.execute({
    sql: `
      SELECT * FROM reglas_disponibilidad
      WHERE strftime('%Y-%m', fecha) = ?
    `,
    args: [targetMonthStr]
  });
  return result.rows as unknown as ReglaDisponibilidad[];
});

// --- ACTIONS ---
export const useManageStaffAction = globalAction$(
  async (data, requestEvent) => {
    const db = getDbClient(requestEvent.env);

    if (data.action === 'add') {
      const id = crypto.randomUUID();
      await db.execute(
        'INSERT INTO staff (id, nombre, rol) VALUES (?, ?, ?)',
        [id, data.nombre || null, data.rol || null]
      );
      return { success: true, message: 'Empleado agregado exitosamente', id };
    } else if (data.action === 'remove' && data.id) {
      // Borrar reglas y turnos asociados para mantener consistencia
      await db.batch([
        { sql: 'DELETE FROM turnos_asignados WHERE staff_id = ?', args: [data.id] },
        { sql: 'DELETE FROM reglas_disponibilidad WHERE staff_id = ?', args: [data.id] },
        { sql: 'DELETE FROM staff WHERE id = ?', args: [data.id] }
      ]);
      return { success: true, message: 'Empleado eliminado exitosamente' };
    }

    return requestEvent.fail(400, { message: 'Acción no válida' });
  },
  zod$({
    action: z.enum(['add', 'remove']),
    id: z.string().optional(),
    nombre: z.string().min(2).optional(),
    rol: z.string().optional(),
  })
);

// Toggle Shift Manual Action
export const useToggleShiftAction = globalAction$(
  async (data, requestEvent) => {
    const db = getDbClient(requestEvent.env);

    // Primero borramos cualquier asignación o regla existente para ese empleado en ese día
    await db.batch([
      { sql: 'DELETE FROM turnos_asignados WHERE staff_id = ? AND dia = ?', args: [data.staff_id, data.fecha] },
      { sql: 'DELETE FROM reglas_disponibilidad WHERE staff_id = ? AND fecha = ?', args: [data.staff_id, data.fecha] }
    ]);

    if (data.tipo_asignacion === 'Mañana' || data.tipo_asignacion === 'Tarde' || data.tipo_asignacion === 'Noche') {
      await db.execute(
        'INSERT INTO turnos_asignados (id, dia, turno, staff_id) VALUES (?, ?, ?, ?)',
        [crypto.randomUUID(), data.fecha, data.tipo_asignacion, data.staff_id]
      );
    } else if (data.tipo_asignacion === 'Franco') {
      await db.execute(
        'INSERT INTO reglas_disponibilidad (id, staff_id, fecha, tipo) VALUES (?, ?, ?, ?)',
        [crypto.randomUUID(), data.staff_id, data.fecha, 'Franco']
      );
    }
    // Si es 'Vacío', simplemente se queda borrado

    return { success: true };
  },
  zod$({
    staff_id: z.string(),
    fecha: z.string(),
    tipo_asignacion: z.enum(['Mañana', 'Tarde', 'Noche', 'Franco', 'Vacío'])
  })
);

// Main Dashboard Page
export default component$(() => {
  const loc = useLocation();
  const staff = useStaffLoader();
  const assignments = useAssignmentsLoader();
  const rules = useRulesLoader();
  const manageStaffAction = useManageStaffAction();
  const toggleShiftAction = useToggleShiftAction();

  const hoy = new Date();
  const paramAnio = loc.url.searchParams.get('anio');
  const paramMes = loc.url.searchParams.get('mes');

  const currentAnio = paramAnio ? parseInt(paramAnio) : hoy.getFullYear();
  const currentMes = paramMes ? parseInt(paramMes) : hoy.getMonth() + 1; // 1-12

  const isStaffModalOpen = useSignal<boolean>(false);

  return (
    <div class="min-h-screen bg-slate-100 p-4 md:p-6 font-sans">
      <div class="w-full mx-auto space-y-6">

        {/* Header */}
        <header class="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-slate-900">Ligustros Sync</h1>
            <p class="text-sm text-slate-500 mt-1">Planilla Inteligente de Gestión de Turnos (Asignación Manual)</p>
          </div>
          <button
            onClick$={() => isStaffModalOpen.value = true}
            class="inline-flex shrink-0 items-center justify-center gap-2 px-4 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
            type="button"
          >
            <svg class="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path></svg>
            ⚙️ Gestionar Personal
          </button>
        </header>

        {/* Seleccionador de Meses */}
        <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-2 overflow-x-auto custom-scrollbar">
          <div class="flex items-center gap-2 min-w-max px-2">
            <Link
              href={`?anio=${currentAnio - 1}&mes=12`}
              class="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              title="Año Anterior"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
            </Link>

            <span class="font-bold text-slate-700 mx-2 text-lg">{currentAnio}</span>

            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
              const isSelected = m === currentMes;
              const nombreMes = new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(new Date(2000, m - 1, 1));
              return (
                <Link
                  key={m}
                  href={`?anio=${currentAnio}&mes=${m}`}
                  class={`px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${isSelected
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                >
                  {nombreMes}
                </Link>
              );
            })}

            <Link
              href={`?anio=${currentAnio + 1}&mes=1`}
              class="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              title="Año Siguiente"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
            </Link>
          </div>
        </div>

        {/* Tableros Principales */}
        <div class="flex flex-col gap-6 items-start">

          {/* Grid Derecha (Cuadrante Mes - Planilla Inteligente) */}
          <div class="flex-1 w-full flex flex-col overflow-hidden min-h-[600px] bg-white rounded-xl shadow-sm border border-slate-200">
            <RosterGrid
              assignments={assignments.value}
              rules={rules.value}
              staffList={staff.value}
              anio={currentAnio}
              mes={currentMes}
              toggleAction={toggleShiftAction}
            />
          </div>

        </div>

      </div>

      {/* Modal Overlay para Staff Manager */}
      {isStaffModalOpen.value && (
        <div class="fixed inset-0 z-100 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm transition-opacity">
          <div class="w-full max-w-lg bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden relative max-h-[90vh]">
            <button
              onClick$={() => isStaffModalOpen.value = false}
              class="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors bg-white/50 backdrop-blur-md"
              title="Cerrar modal"
              type="button"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
            <StaffManager
              staffList={staff.value}
              manageAction={manageStaffAction}
            />
          </div>
        </div>
      )}

    </div>
  );
});

export const head: DocumentHead = {
  title: "Ligustros Sync - Dashboard",
  meta: [
    {
      name: "description",
      content: "Sistema de gestión de turnos interactivo para Ligustros",
    },
  ],
};
