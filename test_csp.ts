import { generarMatrizTurnos, validarMatriz, generarReporte, StaffCSP, ConfigCSP } from './src/lib/scheduler.ts';

const staff: StaffCSP[] = [
  { id: 'Loli',         turnosHabilitados: ['Mañana'] },
  { id: 'Ana Decurto',  turnosHabilitados: ['Tarde', 'Noche', 'Mañana'] },
  { id: 'Paula',        turnosHabilitados: ['Tarde'] },
  { id: 'Emiliano',     turnosHabilitados: ['Mañana'] },
  { id: 'Carolina',     turnosHabilitados: ['Mañana', 'Tarde'] },
  { id: 'Maria',        turnosHabilitados: ['Noche'] },
  { id: 'Natalia',      turnosHabilitados: ['Tarde', 'Mañana'] },
  { id: 'Yamila',       turnosHabilitados: ['Mañana'] },
  { id: 'Dora',         turnosHabilitados: ['Tarde'] },
  { id: 'Ana De Maris', turnosHabilitados: ['Noche'] },
  { id: 'Jaki',         turnosHabilitados: ['Mañana', 'Tarde'] },
  { id: 'Viviana',      turnosHabilitados: ['Mañana'] },
  { id: 'Patricia G',   turnosHabilitados: ['Tarde'] },
  { id: 'Patricia R',   turnosHabilitados: ['Tarde'] },
  { id: 'Pat Cap',      turnosHabilitados: ['Tarde'] },
];

const config: ConfigCSP = {
    francos_mes_corto: 6,
    francos_mes_largo: 7,
    min_manana: 3,
    max_manana: 6,
    min_tarde: 3,
    max_tarde: 6,
    min_noche: 2,
    max_noche: 2,
};

const dias = 31;
try {
    const start = Date.now();
    const matriz = generarMatrizTurnos(staff, config, dias);
    const ms = Date.now() - start;
    console.log(`Generado en ${ms}ms`);
    console.log(generarReporte(matriz, dias));
    
    const violaciones = validarMatriz(matriz, staff, config, dias);
    if(violaciones.length > 0) {
        console.error("VIOLACIONES ENCONTRADAS:");
        violaciones.forEach(v => console.error(`- [${v.tipo}]: ${v.mensaje}`));
    } else {
        console.log("✅ MATRIZ 100% VALIDA Y MATEMATICAMENTE CORRECTA");
    }
} catch (e: any) {
    console.error(e.message);
}
