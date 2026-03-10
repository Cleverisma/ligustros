import { component$ } from '@builder.io/qwik';
import { Form, globalAction$, zod$, z, type DocumentHead } from '@builder.io/qwik-city';

export const useLoginAction = globalAction$(
  async ({ codigo }, requestEvent) => {
    const passphrase = requestEvent.env.get('ADMIN_PASSPHRASE');

    if (!passphrase) {
        console.warn('ADMIN_PASSPHRASE is not set in environment variables');
    }

    if (codigo === passphrase) {
      requestEvent.cookie.set('admin_session', 'authenticated_admin', {
        httpOnly: true,
        secure: true,
        maxAge: [30, 'days'],
        path: '/'
      });
      throw requestEvent.redirect(302, '/');
    }

    return requestEvent.fail(401, {
      message: 'Código incorrecto'
    });
  },
  zod$({
    codigo: z.string().min(1, 'Ingresa el código de acceso')
  })
);

export default component$(() => {
  const action = useLoginAction();

  return (
    <div class="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div class="max-w-md w-full bg-slate-800 p-8 rounded-2xl shadow-xl border border-slate-700">
        <div class="text-center mb-8">
          <h1 class="text-3xl font-bold text-white mb-2">Ligustros Sync</h1>
          <p class="text-slate-400">Acceso restringido para administradores</p>
        </div>

        <Form action={action} class="space-y-6">
          <div>
            <label for="codigo" class="block text-sm font-medium text-slate-300 mb-2">
              Código de Acceso
            </label>
            <input
              type="password"
              id="codigo"
              name="codigo"
              class="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
              placeholder="••••••••"
              required
            />
          </div>

          {action.value?.failed && (
            <div class="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm text-center font-medium">
              {action.value.message}
            </div>
          )}

          <button
            type="submit"
            disabled={action.isRunning}
            class="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-lg hover:shadow-indigo-500/25 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          >
            {action.isRunning ? 'Verificando...' : 'Ingresar al Dashboard'}
          </button>
        </Form>
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: 'Login - Ligustros Sync',
};
