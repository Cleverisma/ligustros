import { component$, useSignal } from '@builder.io/qwik';
import { routeLoader$, routeAction$, zod$, z, Form, type DocumentHead } from '@builder.io/qwik-city';
import { getDbClient } from '../../server/db/turso';
import { tursoClient } from '../../utils/turso';
import type { ConfiguracionGlobal } from '../../types';

export const useConfigGlobalLoader = routeLoader$(async (requestEvent) => {
    const db = getDbClient(requestEvent.env);

    // Ensure the table exists
    await db.execute(`
        CREATE TABLE IF NOT EXISTS configuracion_global (
            id TEXT PRIMARY KEY,
            francos_mes_corto INTEGER NOT NULL DEFAULT 6,
            francos_mes_largo INTEGER NOT NULL DEFAULT 7,
            min_manana INTEGER NOT NULL DEFAULT 5,
            max_manana INTEGER NOT NULL DEFAULT 6,
            min_tarde INTEGER NOT NULL DEFAULT 5,
            max_tarde INTEGER NOT NULL DEFAULT 6,
            min_noche INTEGER NOT NULL DEFAULT 2,
            max_noche INTEGER NOT NULL DEFAULT 2
        )
    `);

    // Ensure default row exists
    await db.execute(`
        INSERT OR IGNORE INTO configuracion_global (id, francos_mes_corto, francos_mes_largo, min_manana, max_manana, min_tarde, max_tarde, min_noche, max_noche)
        VALUES ('default', 6, 7, 5, 6, 5, 6, 2, 2)
    `);

    // Fetch the config
    const result = await db.execute("SELECT * FROM configuracion_global WHERE id = 'default'");
    return result.rows[0] as unknown as ConfiguracionGlobal;
});

// Zod schema for configuration validation
const configSchema = z.object({
    francos_mes_corto: z.coerce.number().min(0).max(15),
    francos_mes_largo: z.coerce.number().min(0).max(15),
    min_manana: z.coerce.number().min(0).max(10),
    max_manana: z.coerce.number().min(0).max(10),
    min_tarde: z.coerce.number().min(0).max(10),
    max_tarde: z.coerce.number().min(0).max(10),
    min_noche: z.coerce.number().min(0).max(10),
    max_noche: z.coerce.number().min(0).max(10),
}).refine(data => data.min_manana <= data.max_manana, {
    message: "El mínimo de Mañana no puede ser mayor al máximo",
    path: ['min_manana']
}).refine(data => data.min_tarde <= data.max_tarde, {
    message: "El mínimo de Tarde no puede ser mayor al máximo",
    path: ['min_tarde']
}).refine(data => data.min_noche <= data.max_noche, {
    message: "El mínimo de Noche no puede ser mayor al máximo",
    path: ['min_noche']
});

export const useUpdateConfigAction = routeAction$(
    async (data, requestEvent) => {
        const db = getDbClient(requestEvent.env);

        await db.execute({
            sql: `UPDATE configuracion_global SET 
                    francos_mes_corto = ?, 
                    francos_mes_largo = ?, 
                    min_manana = ?, max_manana = ?, 
                    min_tarde = ?, max_tarde = ?, 
                    min_noche = ?, max_noche = ? 
                  WHERE id = 'default'`,
            args: [
                data.francos_mes_corto, data.francos_mes_largo,
                data.min_manana, data.max_manana,
                data.min_tarde, data.max_tarde,
                data.min_noche, data.max_noche
            ]
        });

        return { success: true, message: 'Configuración guardada exitosamente' };
    },
    zod$(configSchema)
);

export const useUpdatePassphraseAction = routeAction$(
    async ({ claveActual, nuevaClave }, requestEvent) => {
        try {
            const db = tursoClient(requestEvent);
            // 1. Verify current passphrase
            const check = await db.execute({
                sql: "SELECT valor FROM configuracion WHERE clave = 'admin_passphrase' LIMIT 1",
                args: [],
            });
            const row = check.rows[0];
            if (!row || row.valor !== claveActual) {
                return requestEvent.fail(401, { message: 'El código actual es incorrecto' });
            }
            // 2. Update to new passphrase
            await db.execute({
                sql: "UPDATE configuracion SET valor = ? WHERE clave = 'admin_passphrase'",
                args: [nuevaClave],
            });
            return { success: true, message: 'Código actualizado correctamente' };
        } catch (e: any) {
            console.error('[configuracion] Error actualizando passphrase:', e);
            return requestEvent.fail(500, { message: e?.message ?? 'Error al actualizar el código' });
        }
    },
    zod$({
        claveActual: z.string().min(1, 'Ingresá el código actual'),
        nuevaClave: z.string().min(4, 'El nuevo código debe tener al menos 4 caracteres'),
    })
);



export default component$(() => {
    const configData = useConfigGlobalLoader();
    const updateAction = useUpdateConfigAction();
    const passphraseAction = useUpdatePassphraseAction();
    const config = configData.value;
    const showSuccess = useSignal(false);
    const showPassSuccess = useSignal(false);

    if (updateAction.value?.success && !updateAction.isRunning && !showSuccess.value) {
        showSuccess.value = true;
        setTimeout(() => { showSuccess.value = false; }, 3000);
    }
    if (passphraseAction.value?.success && !passphraseAction.isRunning && !showPassSuccess.value) {
        showPassSuccess.value = true;
        setTimeout(() => { showPassSuccess.value = false; }, 3000);
    }

    return (
        <div class="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans pb-12 transition-colors">
            <header class="bg-indigo-600 dark:bg-indigo-900 px-6 py-8 text-white shadow-lg sticky top-0 z-20 transition-colors">
                <div class="max-w-3xl mx-auto flex items-center justify-between">
                    <div>
                        <h1 class="text-3xl font-extrabold tracking-tight mb-2">Configuración</h1>
                        <p class="text-indigo-100 dark:text-indigo-200 font-medium opacity-90">Gestión de Reglas de Negocio</p>
                    </div>
                    <a href="/" class="inline-flex items-center gap-2 bg-indigo-700 dark:bg-indigo-800 hover:bg-indigo-800 dark:hover:bg-indigo-700 px-4 py-2 rounded-lg text-sm font-semibold transition-colors focus:ring-2 focus:ring-white">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
                        Volver al Panel
                    </a>
                </div>
            </header>

            <main class="max-w-3xl mx-auto px-4 -mt-6 relative z-30">
                <Form action={updateAction} class="space-y-6">
                    {/* Alertas */}
                    {updateAction.value?.failed && (
                        <div class="bg-rose-50 dark:bg-rose-900/30 border-l-4 border-rose-500 p-4 rounded-r-lg shadow-sm">
                            <div class="flex">
                                <div class="flex-shrink-0">
                                    <svg class="h-5 w-5 text-rose-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" /></svg>
                                </div>
                                <div class="ml-3">
                                    <p class="text-sm text-rose-700 dark:text-rose-300">
                                        No se pudo guardar la configuración. Revisa los valores ingresados.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {showSuccess.value && (
                        <div class="bg-emerald-50 dark:bg-emerald-900/30 border-l-4 border-emerald-500 p-4 rounded-r-lg shadow-sm animate-fade-in text-emerald-800 dark:text-emerald-300 font-medium">
                            {updateAction.value?.message}
                        </div>
                    )}

                    {/* Regla de Francos */}
                    <div class="bg-white dark:bg-slate-900 rounded-2xl shadow-xl overflow-hidden border border-slate-100 dark:border-slate-800 transition-colors">
                        <div class="px-6 py-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center gap-3 transition-colors">
                            <div class="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center">
                                <svg class="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                            </div>
                            <h2 class="text-lg font-bold text-slate-800 dark:text-slate-100">Política de Francos Mensuales</h2>
                        </div>
                        <div class="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label for="francos_mes_corto" class="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Meses Cortos (≤ 30 días)</label>
                                <input type="number" id="francos_mes_corto" name="francos_mes_corto" value={updateAction.formData?.get('francos_mes_corto') || config.francos_mes_corto} required min="0" max="15"
                                    class="w-full rounded-xl border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-slate-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 transition-colors" />
                                <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">Cantidad objetivo mínima obligatoria.</p>
                                {updateAction.value?.fieldErrors?.francos_mes_corto && <p class="text-rose-500 text-xs mt-1">{updateAction.value.fieldErrors.francos_mes_corto}</p>}
                            </div>
                            <div>
                                <label for="francos_mes_largo" class="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Meses Largos (31 días)</label>
                                <input type="number" id="francos_mes_largo" name="francos_mes_largo" value={updateAction.formData?.get('francos_mes_largo') || config.francos_mes_largo} required min="0" max="15"
                                    class="w-full rounded-xl border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-slate-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 transition-colors" />
                                <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">Objetivo para Ene, Mar, May, Jul, Ago, Oct, Dic.</p>
                                {updateAction.value?.fieldErrors?.francos_mes_largo && <p class="text-rose-500 text-xs mt-1">{updateAction.value.fieldErrors.francos_mes_largo}</p>}
                            </div>
                        </div>
                    </div>

                    {/* Coberturas Mínimas y Máximas */}
                    <div class="bg-white dark:bg-slate-900 rounded-2xl shadow-xl overflow-hidden border border-slate-100 dark:border-slate-800 transition-colors">
                        <div class="px-6 py-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center gap-3 transition-colors">
                            <div class="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                                <svg class="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                            </div>
                            <h2 class="text-lg font-bold text-slate-800 dark:text-slate-100">Cuotas de Cobertura Diaria</h2>
                        </div>

                        <div class="p-6 space-y-8">
                            {/* Turno Mañana */}
                            <div>
                                <h3 class="text-base font-bold text-emerald-700 dark:text-emerald-400 mb-3 uppercase tracking-wider">Turno Mañana</h3>
                                <div class="grid grid-cols-2 gap-4">
                                    <div>
                                        <label for="min_manana" class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Mínimo Requerido</label>
                                        <input type="number" id="min_manana" name="min_manana" value={updateAction.formData?.get('min_manana') || config.min_manana} required min="0" max="10"
                                            class="w-full rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 shadow-sm focus:border-emerald-500 focus:ring-emerald-500" />
                                        {updateAction.value?.fieldErrors?.min_manana && <p class="text-rose-500 text-xs mt-1">{updateAction.value.fieldErrors.min_manana}</p>}
                                    </div>
                                    <div>
                                        <label for="max_manana" class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Máximo Ideal</label>
                                        <input type="number" id="max_manana" name="max_manana" value={updateAction.formData?.get('max_manana') || config.max_manana} required min="0" max="10"
                                            class="w-full rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 shadow-sm focus:border-emerald-500 focus:ring-emerald-500" />
                                    </div>
                                </div>
                            </div>

                            <hr class="border-slate-100 dark:border-slate-800" />

                            {/* Turno Tarde */}
                            <div>
                                <h3 class="text-base font-bold text-orange-600 dark:text-orange-400 mb-3 uppercase tracking-wider">Turno Tarde</h3>
                                <div class="grid grid-cols-2 gap-4">
                                    <div>
                                        <label for="min_tarde" class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Mínimo Requerido</label>
                                        <input type="number" id="min_tarde" name="min_tarde" value={updateAction.formData?.get('min_tarde') || config.min_tarde} required min="0" max="10"
                                            class="w-full rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 shadow-sm focus:border-orange-500 focus:ring-orange-500" />
                                        {updateAction.value?.fieldErrors?.min_tarde && <p class="text-rose-500 text-xs mt-1">{updateAction.value.fieldErrors.min_tarde}</p>}
                                    </div>
                                    <div>
                                        <label for="max_tarde" class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Máximo Ideal</label>
                                        <input type="number" id="max_tarde" name="max_tarde" value={updateAction.formData?.get('max_tarde') || config.max_tarde} required min="0" max="10"
                                            class="w-full rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 shadow-sm focus:border-orange-500 focus:ring-orange-500" />
                                    </div>
                                </div>
                            </div>

                            <hr class="border-slate-100 dark:border-slate-800" />

                            {/* Turno Noche */}
                            <div>
                                <h3 class="text-base font-bold text-indigo-700 dark:text-indigo-400 mb-3 uppercase tracking-wider">Turno Noche</h3>
                                <div class="grid grid-cols-2 gap-4">
                                    <div>
                                        <label for="min_noche" class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Mínimo Requerido</label>
                                        <input type="number" id="min_noche" name="min_noche" value={updateAction.formData?.get('min_noche') || config.min_noche} required min="0" max="10"
                                            class="w-full rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500" />
                                        {updateAction.value?.fieldErrors?.min_noche && <p class="text-rose-500 text-xs mt-1">{updateAction.value.fieldErrors.min_noche}</p>}
                                    </div>
                                    <div>
                                        <label for="max_noche" class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Máximo Ideal</label>
                                        <input type="number" id="max_noche" name="max_noche" value={updateAction.formData?.get('max_noche') || config.max_noche} required min="0" max="10"
                                            class="w-full rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="flex justify-end pb-8">
                        <button type="submit" disabled={updateAction.isRunning} class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-8 rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed w-full md:w-auto text-lg flex items-center justify-center gap-2">
                            {updateAction.isRunning ? (
                                <svg class="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                            ) : (
                                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg>
                            )}
                            Guardar Configuración
                        </button>
                    </div>
                </Form>

                {/* Código de acceso */}
                <Form action={passphraseAction} class="pb-8">
                    <div class="bg-white dark:bg-slate-900 rounded-2xl shadow-xl overflow-hidden border border-slate-100 dark:border-slate-800 transition-colors">
                        <div class="px-6 py-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center gap-3 transition-colors">
                            <div class="w-8 h-8 rounded-full bg-rose-100 dark:bg-rose-900/50 flex items-center justify-center">
                                <svg class="w-4 h-4 text-rose-600 dark:text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"></path></svg>
                            </div>
                            <h2 class="text-lg font-bold text-slate-800 dark:text-slate-100">Código de Acceso</h2>
                        </div>
                        <div class="p-6 space-y-5">
                            <div>
                                <label for="claveActual" class="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Código Actual</label>
                                <input
                                    type="password"
                                    id="claveActual"
                                    name="claveActual"
                                    class="w-full max-w-sm rounded-xl border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-slate-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 transition-colors"
                                    placeholder="Tu código actual"
                                    required
                                />
                                {passphraseAction.value?.fieldErrors?.claveActual && (
                                    <p class="text-rose-500 text-xs mt-1">{passphraseAction.value.fieldErrors.claveActual}</p>
                                )}
                            </div>
                            <div>
                                <label for="nuevaClave" class="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Nuevo Código</label>
                                <input
                                    type="password"
                                    id="nuevaClave"
                                    name="nuevaClave"
                                    class="w-full max-w-sm rounded-xl border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-slate-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 transition-colors"
                                    placeholder="Mínimo 4 caracteres"
                                    minLength={4}
                                    required
                                />
                                {passphraseAction.value?.fieldErrors?.nuevaClave && (
                                    <p class="text-rose-500 text-xs mt-1">{passphraseAction.value.fieldErrors.nuevaClave}</p>
                                )}
                            </div>
                            {showPassSuccess.value && (
                                <div class="bg-emerald-50 dark:bg-emerald-900/30 border-l-4 border-emerald-500 p-3 rounded-r-lg text-emerald-800 dark:text-emerald-300 font-medium text-sm">
                                    {passphraseAction.value?.message}
                                </div>
                            )}
                            {passphraseAction.value?.failed && (
                                <div class="bg-rose-50 dark:bg-rose-900/30 border-l-4 border-rose-500 p-3 rounded-r-lg text-rose-700 dark:text-rose-300 text-sm">
                                    {passphraseAction.value.message}
                                </div>
                            )}
                            <button
                                type="submit"
                                disabled={passphraseAction.isRunning}
                                class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-6 rounded-xl shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {passphraseAction.isRunning ? 'Guardando...' : 'Actualizar Código'}
                            </button>
                        </div>
                    </div>
                </Form>
            </main>
        </div>
    );
});


export const head: DocumentHead = {
    title: 'Configuración de Reglas | Ligustros Sync',
};
