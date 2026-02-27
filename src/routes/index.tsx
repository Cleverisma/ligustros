import { component$, useSignal, $, useVisibleTask$ } from '@builder.io/qwik';
import { routeLoader$, globalAction$, zod$, z, type DocumentHead, useLocation, Link } from '@builder.io/qwik-city';
import { getDbClient } from '../server/db/turso';
import { StaffManager } from '../components/dashboard/StaffManager';
import { RosterGrid } from '../components/dashboard/RosterGrid';
import type { Staff, TurnoAsignado, ReglaDisponibilidad, ConfiguracionGlobal } from '../types';

// --- LOADERS ---
export const useStaffLoader = routeLoader$(async (requestEvent) => {
  const db = getDbClient(requestEvent.env);
  const result = await db.execute('SELECT * FROM staff ORDER BY nombre ASC');
  return result.rows as unknown as Staff[];
});

export const useConfigLoader = routeLoader$(async (requestEvent) => {
  const db = getDbClient(requestEvent.env);
  try {
    const result = await db.execute("SELECT * FROM configuracion_global WHERE id = 'default'");
    if (result.rows.length > 0) {
      return result.rows[0] as unknown as ConfiguracionGlobal;
    }
  } catch (e) {
    console.warn('Config table missing, using defaults.', e);
  }

  return {
    id: 'default', francos_mes_corto: 6, francos_mes_largo: 7,
    min_manana: 5, max_manana: 6, min_tarde: 5, max_tarde: 6, min_noche: 2, max_noche: 2
  } as ConfiguracionGlobal;
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

export const ThemeToggle = component$(() => {
  const isDark = useSignal<boolean>(false);

  useVisibleTask$(() => {
    isDark.value = document.documentElement.classList.contains('dark');
  });

  const toggleTheme = $(() => {
    isDark.value = !isDark.value;
    if (isDark.value) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  });

  return (
    <button
      onClick$={toggleTheme}
      class="inline-flex shrink-0 items-center justify-center p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700/50 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
      title={isDark.value ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      type="button"
    >
      {isDark.value ? (
        <svg class="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
      ) : (
        <svg class="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
      )}
    </button>
  );
});

export const useClonePreviousMonthAction = globalAction$(
  async (data, requestEvent) => {
    const db = getDbClient(requestEvent.env);

    const targetAnio = data.targetAnio;
    const targetMes = data.targetMes;

    let prevAnio = targetAnio;
    let prevMes = targetMes - 1;
    if (prevMes === 0) {
      prevMes = 12;
      prevAnio--;
    }

    const prevMonthStr = `${prevAnio}-${String(prevMes).padStart(2, '0')}`;

    const result = await db.execute({
      sql: `SELECT dia, turno, staff_id FROM turnos_asignados WHERE strftime('%Y-%m', dia) = ? ORDER BY dia ASC`,
      args: [prevMonthStr]
    });

    const prevAssignments = result.rows as unknown as { dia: string; turno: string; staff_id: string }[];

    if (prevAssignments.length === 0) {
      return requestEvent.fail(404, { message: 'No hay datos del mes anterior para clonar.' });
    }

    const daysInTargetMonth = new Date(targetAnio, targetMes, 0).getDate();
    const batchStatements: any[] = [];

    for (const assignment of prevAssignments) {
      const dayStr = assignment.dia.split('-')[2];
      const dayNum = parseInt(dayStr, 10);

      if (dayNum > daysInTargetMonth) {
        continue;
      }

      const newDateStr = `${targetAnio}-${String(targetMes).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;

      batchStatements.push({
        sql: 'INSERT INTO turnos_asignados (dia, turno, staff_id) VALUES (?, ?, ?)',
        args: [newDateStr, assignment.turno, assignment.staff_id]
      });
    }

    if (batchStatements.length === 0) {
      return requestEvent.fail(400, { message: 'No se generaron turnos válidos para clonar.' });
    }

    await db.batch(batchStatements);

    return { success: true, count: batchStatements.length };
  },
  zod$({
    targetAnio: z.number().int().min(2000).max(2100),
    targetMes: z.number().int().min(1).max(12)
  })
);

// Main Dashboard Page
export default component$(() => {
  const loc = useLocation();
  const staff = useStaffLoader();
  const assignments = useAssignmentsLoader();
  const rules = useRulesLoader();
  const configData = useConfigLoader();
  const manageStaffAction = useManageStaffAction();
  const toggleShiftAction = useToggleShiftAction();
  const clonePreviousMonthAction = useClonePreviousMonthAction();

  const hoy = new Date();
  const paramAnio = loc.url.searchParams.get('anio');
  const paramMes = loc.url.searchParams.get('mes');

  const currentAnio = paramAnio ? parseInt(paramAnio) : hoy.getFullYear();
  const currentMes = paramMes ? parseInt(paramMes) : hoy.getMonth() + 1; // 1-12

  const isStaffModalOpen = useSignal<boolean>(false);

  return (
    <>
      <div class="min-h-screen bg-slate-50 dark:bg-slate-900 font-sans pb-10 transition-colors">
        {/* Header */}
        <header class="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition-colors">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Ligustros Sync</h1>
            <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">Planilla Inteligente de Gestión de Turnos (Asignación Manual)</p>
          </div>
          <div class="flex items-center gap-3 flex-wrap">
            <ThemeToggle />
            <Link
              href="/configuracion"
              class="inline-flex shrink-0 items-center justify-center p-2 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:text-slate-400 dark:hover:text-indigo-400 dark:hover:bg-indigo-900/40 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
              title="Configuración de Reglas"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
            </Link>
            <button
              onClick$={$(async () => {
                const html2canvas = (await import('html2canvas-pro')).default;
                const node = document.getElementById('roster-export-area');
                if (node) {
                  // Agregamos feedback visual de carga
                  const originalCursor = document.body.style.cursor;
                  document.body.style.cursor = 'wait';

                  try {
                    const canvas = await html2canvas(node, {
                      backgroundColor: '#ffffff',
                      scale: 2,
                      width: node.scrollWidth,
                      height: node.scrollHeight
                    });

                    const dataUrl = canvas.toDataURL('image/png');
                    const link = document.createElement('a');
                    link.download = `turnos-ligustros-${currentAnio}-${String(currentMes).padStart(2, '0')}.png`;
                    link.href = dataUrl;
                    link.click();
                  } catch (err) {
                    console.error('Error exportando png:', err);
                  } finally {
                    document.body.style.cursor = originalCursor;
                  }
                }
              })}
              class="inline-flex shrink-0 items-center justify-center gap-2 px-4 py-2 border border-emerald-300 dark:border-emerald-700/60 rounded-lg text-sm font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-800/50 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1"
              type="button"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
              📸 Compartir por WhatsApp
            </button>
            <button
              onClick$={() => isStaffModalOpen.value = true}
              class="inline-flex shrink-0 items-center justify-center gap-2 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
              type="button"
            >
              <svg class="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path></svg>
              ⚙️ Gestionar Personal
            </button>
          </div>
        </header>

        {/* Seleccionador de Meses */}
        <div class="mt-6 -mb-2 overflow-x-auto pb-4 custom-scrollbar">
          <div class="flex items-center gap-2 min-w-max px-2">
            <Link
              href={`?anio=${currentAnio - 1}&mes=${currentMes}`}
              class="p-2 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
              title="Año anterior"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
            </Link>

            <div class="text-sm font-bold text-slate-700 dark:text-slate-200 px-3 py-1 bg-white dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700 shadow-sm">
              {currentAnio}
            </div>

            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
              const isSelected = m === currentMes;
              const nombreMes = new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(new Date(2000, m - 1, 1));
              return (
                <Link
                  key={m}
                  href={`?anio=${currentAnio}&mes=${m}`}
                  class={`px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${isSelected
                    ? 'bg-indigo-600 dark:bg-indigo-500 text-white shadow-md'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                >
                  {nombreMes}
                </Link>
              );
            })}

            <Link
              href={`?anio=${currentAnio + 1}&mes=${currentMes}`}
              class="p-2 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
              title="Año siguiente"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
            </Link>
          </div>
        </div>

        {/* Tableros Principales */}
        <main class="w-full mx-auto space-y-6 p-4 md:p-6 pt-0">
          {staff.value.length === 0 ? (
            <div class="pt-4 h-full flex flex-col items-center">
              <span class="inline-flex items-center justify-center p-3 rounded-xl bg-orange-100 dark:bg-orange-900/50 text-orange-600 dark:text-orange-400 mb-4 shadow-sm relative">
                <svg class="w-8 h-8 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                <div class="absolute inset-0 bg-orange-200 dark:bg-orange-800/30 blur-md rounded-full opacity-50"></div>
              </span>
              <h2 class="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mb-3">Directorio Vacío</h2>
              <p class="text-slate-500 dark:text-slate-400 text-center text-sm mb-6 max-w-[280px]">
                No tienes personal registrado. Para empezar a asignar turnos, necesitas agregar al menos un miembro al staff.
              </p>
              <button
                onClick$={() => isStaffModalOpen.value = true}
                class="inline-flex items-center justify-center px-5 py-2.5 border border-transparent shadow-md text-sm font-semibold rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
              >
                Agregar mi primer empleado
              </button>
            </div>
          ) : (
            <RosterGrid
              staffList={staff.value}
              assignments={assignments.value}
              rules={rules.value}
              mes={currentMes}
              anio={currentAnio}
              toggleAction={toggleShiftAction}
              config={configData.value}
              cloneAction={clonePreviousMonthAction}
            />
          )}
        </main>
      </div>

      {/* Staff Management Modal overlay */}
      {isStaffModalOpen.value && (
        <dialog
          open
          class="fixed inset-0 z-100 w-full h-full bg-transparent flex items-center justify-center p-4 sm:p-6"
          onClick$={(e) => {
            // Close when clicking empty space
            if (e.target === e.currentTarget) isStaffModalOpen.value = false;
          }}
        >
          {/* Backdrop blur overlay */}
          <div class="fixed inset-0 bg-slate-900/50 dark:bg-slate-950/70 backdrop-blur-sm transition-opacity" aria-hidden="true" />

          {/* Modal Container */}
          <div class="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-2xl dark:shadow-black border border-slate-200 dark:border-slate-800 overflow-hidden z-10 animate-fade-in scale-in">
            {/* Close Button Header */}
            <div class="absolute top-4 right-4 z-20">
              <button
                onClick$={() => isStaffModalOpen.value = false}
                class="p-2 rounded-full text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
                aria-label="Cerrar modal de staff"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            <StaffManager
              staffList={staff.value}
              manageAction={manageStaffAction}
            />
          </div>
        </dialog>
      )}
    </>
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
