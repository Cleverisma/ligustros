import { component$ } from '@builder.io/qwik';
import { routeLoader$, routeAction$, globalAction$, zod$, z, type DocumentHead } from '@builder.io/qwik-city';
import { getDbClient } from '../server/db/turso';

// --- LOADERS ---
// Fetch all staff members from Turso
export const useStaffLoader = routeLoader$(async (requestEvent) => {
  const db = getDbClient(requestEvent.env);
  const result = await db.execute('SELECT * FROM staff ORDER BY nombre ASC');
  return result.rows as unknown as Array<{ id: string; nombre: string; rol: string; }>;
});

// Fetch assignments for the current month
// In a real app, you might pass the month as a query param. We'll default to current month.
export const useAssignmentsLoader = routeLoader$(async (requestEvent) => {
  const db = getDbClient(requestEvent.env);

  // Example query: SELECT * FROM turnos_asignados WHERE strftime('%Y-%m', dia) = strftime('%Y-%m', 'now')
  const result = await db.execute(`
    SELECT * FROM turnos_asignados 
    WHERE strftime('%Y-%m', dia) = strftime('%Y-%m', 'now') 
    ORDER BY dia ASC
  `);
  return result.rows as unknown as Array<{ id: string; dia: string; turno: string; staff_id: string; }>;
});

// Fetch availability rules (francos/exceptions) for the current month
export const useRulesLoader = routeLoader$(async (requestEvent) => {
  const db = getDbClient(requestEvent.env);

  const result = await db.execute(`
    SELECT * FROM reglas_disponibilidad
    WHERE strftime('%Y-%m', fecha) = strftime('%Y-%m', 'now')
  `);
  return result.rows as unknown as Array<{ id: string; staff_id: string; fecha: string; tipo: string; }>;
});

// --- ACTIONS ---
// Add or Remove Staff
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
      await db.execute(
        'DELETE FROM staff WHERE id = ?',
        [data.id]
      );
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

// Add Exception / Day Off
export const useAddRuleAction = globalAction$(
  async (data, requestEvent) => {
    const db = getDbClient(requestEvent.env);
    const id = crypto.randomUUID();

    await db.execute(
      'INSERT INTO reglas_disponibilidad (id, staff_id, fecha, tipo) VALUES (?, ?, ?, ?)',
      [id, data.staff_id, data.fecha, data.tipo]
    );

    return { success: true, message: 'Regla agregada exitosamente' };
  },
  zod$({
    staff_id: z.string(),
    fecha: z.string(), // YYYY-MM-DD
    tipo: z.enum(['Franco', 'Excepcion'])
  })
);

// Add Generate Roster Action
export const useGenerateRosterAction = globalAction$(
  async (data, requestEvent) => {
    const db = getDbClient(requestEvent.env);

    // 1. Fetch data for Algorithm
    const staffRes = await db.execute('SELECT * FROM staff');
    const reglasRes = await db.execute(`
      SELECT * FROM reglas_disponibilidad 
      WHERE strftime('%Y-%m', fecha) = strftime('%Y-%m', ?)
    `); // data.fechaBase is YYYY-MM

    // 2. Import logic (since we are inside action, we can use dynamic or static imports of server-side code)
    const { generarCuadrante } = await import('../utils/scheduler/generarCuadrante');

    const [anioStr, mesStr] = data.fechaBase.split('-');
    const asigNuevas = generarCuadrante(
      parseInt(anioStr, 10),
      parseInt(mesStr, 10),
      staffRes.rows as any,
      reglasRes.rows as any
    );

    // 3. Delete existing assignments for the month
    await db.execute(
      `DELETE FROM turnos_asignados WHERE strftime('%Y-%m', dia) = ?`,
      [data.fechaBase]
    );

    // 4. Batch insert new assignments
    if (asigNuevas.length > 0) {
      const statements = asigNuevas.map(a => ({
        sql: 'INSERT INTO turnos_asignados (id, dia, turno, staff_id) VALUES (?, ?, ?, ?)',
        args: [crypto.randomUUID(), a.dia, a.turno, a.staff_id]
      }));
      await db.batch(statements);
    }

    return { success: true, message: `Generado cuadrante con ${asigNuevas.length} turnos` };
  },
  zod$({
    fechaBase: z.string(), // YYYY-MM
  })
);

import { StaffManager } from '../components/dashboard/StaffManager';
import { RosterGrid } from '../components/dashboard/RosterGrid';
import { Form } from '@builder.io/qwik-city';

// Main Dashboard Page
export default component$(() => {
  const staff = useStaffLoader();
  const assignments = useAssignmentsLoader();
  const manageStaffAction = useManageStaffAction();
  const generateRosterAction = useGenerateRosterAction();

  // Fechas actuales
  const hoy = new Date();
  const currentAnio = hoy.getFullYear();
  const currentMes = hoy.getMonth() + 1; // 1-12
  const fechaBase = `${currentAnio}-${String(currentMes).padStart(2, '0')}`;

  return (
    <div class="min-h-screen bg-slate-50 p-4 md:p-8 font-sans">
      <div class="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <header class="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div>
            <h1 class="text-3xl font-bold tracking-tight text-slate-900">Ligustros Sync</h1>
            <p class="text-slate-500 mt-1">Plataforma de generación automática de turnos</p>
          </div>
          <div class="flex items-center gap-3">
            <Form action={generateRosterAction}>
              <input type="hidden" name="fechaBase" value={fechaBase} />
              <button
                type="submit"
                class={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                  ${generateRosterAction.isRunning
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}
                disabled={generateRosterAction.isRunning}
              >
                {generateRosterAction.isRunning ? (
                  <>
                    <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Generando...
                  </>
                ) : (
                  <>Autogenerar Cuadrante</>
                )}
              </button>
            </Form>
          </div>
        </header>

        {generateRosterAction.value?.success && (
          <div class="bg-emerald-50 text-emerald-800 p-4 rounded-lg border border-emerald-200">
            {generateRosterAction.value.message}
          </div>
        )}

        {/* Tableros Principales */}
        <div class="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">

          {/* Sidebar Izquierda (Gestión de Staff) */}
          <div class="lg:col-span-1 space-y-6 flex flex-col">
            <StaffManager
              staffList={staff.value as any}
              manageAction={manageStaffAction}
            />
          </div>

          {/* Grid Derecha (Cuadrante Mes) */}
          <div class="lg:col-span-3 flex-1 flex flex-col h-full min-h-[600px]">
            <RosterGrid
              assignments={assignments.value as any}
              staffList={staff.value as any}
              anio={currentAnio}
              mes={currentMes}
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
      content: "Sistema de gestión de turnos para Ligustros",
    },
  ],
};
