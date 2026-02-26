import { component$ } from '@builder.io/qwik';
import { routeLoader$, globalAction$, zod$, z, type DocumentHead } from '@builder.io/qwik-city';
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
  const result = await db.execute(`
    SELECT * FROM turnos_asignados 
    WHERE strftime('%Y-%m', dia) = strftime('%Y-%m', 'now') 
    ORDER BY dia ASC
  `);
  return result.rows as unknown as TurnoAsignado[];
});

export const useRulesLoader = routeLoader$(async (requestEvent) => {
  const db = getDbClient(requestEvent.env);
  const result = await db.execute(`
    SELECT * FROM reglas_disponibilidad
    WHERE strftime('%Y-%m', fecha) = strftime('%Y-%m', 'now')
  `);
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
  const staff = useStaffLoader();
  const assignments = useAssignmentsLoader();
  const rules = useRulesLoader();
  const manageStaffAction = useManageStaffAction();
  const toggleShiftAction = useToggleShiftAction();

  const hoy = new Date();
  const currentAnio = hoy.getFullYear();
  const currentMes = hoy.getMonth() + 1; // 1-12

  return (
    <div class="min-h-screen bg-slate-100 p-4 md:p-6 font-sans">
      <div class="w-full mx-auto space-y-6">

        {/* Header */}
        <header class="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h1 class="text-2xl font-bold tracking-tight text-slate-900">Ligustros Sync</h1>
          <p class="text-sm text-slate-500 mt-1">Planilla Inteligente de Gestión de Turnos (Asignación Manual)</p>
        </header>

        {/* Tableros Principales */}
        <div class="flex flex-col xl:flex-row gap-6 items-start">

          {/* Sidebar Izquierda (Gestión de Staff) */}
          <div class="w-full xl:w-80 shrink-0 flex flex-col">
            <StaffManager
              staffList={staff.value}
              manageAction={manageStaffAction}
            />
          </div>

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
