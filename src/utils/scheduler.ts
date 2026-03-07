export type Turno = 'Mañana' | 'Tarde' | 'Noche' | 'Franco' | 'Vacio';

export interface StaffCSP {
    id: string;
    turnosHabilitados: Exclude<Turno, 'Franco' | 'Vacio'>[];
}

export interface ConfigCSP {
    francos_mes_corto: number;
    francos_mes_largo: number;
    min_manana: number; max_manana: number;
    min_tarde: number; max_tarde: number;
    min_noche: number; max_noche: number;
}

export async function generateSchedule(
    staffList: StaffCSP[],
    config: ConfigCSP,
    anio: number,
    mes: number
): Promise<Record<string, Turno[]>> {
    const diasDelMes = new Date(anio, mes, 0).getDate();
    const targetFrancos = diasDelMes >= 31 ? config.francos_mes_largo : config.francos_mes_corto;

    const schedule: Record<string, Turno[]> = {};
    const francosCount: Record<string, number> = {};

    staffList.forEach(s => {
        schedule[s.id] = Array(diasDelMes).fill('Vacio');
        francosCount[s.id] = 0;
    });

    const nightStaff = staffList.filter(s => s.turnosHabilitados.includes('Noche'));
    
    if (nightStaff.length < 2) {
        throw new Error("No hay suficiente personal habilitado para cubrir 2 Noches diarias.");
    }

    // FASE 1: CLAVAR LAS NOCHES (ESTRATEGIA DE BLOQUES)
    for (let day = 0; day < diasDelMes; day++) {
        let assignedTonight = 0;

        const candidates = [...nightStaff].sort((a, b) => {
            const aYesterday = day > 0 && schedule[a.id][day - 1] === 'Noche' ? 1 : 0;
            const bYesterday = day > 0 && schedule[b.id][day - 1] === 'Noche' ? 1 : 0;
            
            if (aYesterday !== bYesterday) return bYesterday - aYesterday;
            
            const aNoches = schedule[a.id].filter(t => t === 'Noche').length;
            const bNoches = schedule[b.id].filter(t => t === 'Noche').length;
            return aNoches - bNoches;
        });

        for (const emp of candidates) {
            if (assignedTonight >= 2) break;

            let consecutive = 0;
            for (let d = day - 1; d >= Math.max(0, day - 6); d--) {
                if (schedule[emp.id][d] !== 'Franco' && schedule[emp.id][d] !== 'Vacio') consecutive++;
                else break;
            }

            if (consecutive >= 6) {
                if (schedule[emp.id][day] === 'Vacio') {
                    schedule[emp.id][day] = 'Franco';
                    francosCount[emp.id]++;
                }
                continue;
            }

            schedule[emp.id][day] = 'Noche';
            assignedTonight++;
        }
    }

    // FASE 2: PAGAR EL IMPUESTO BIOLÓGICO
    for (const emp of nightStaff) {
        for (let day = 0; day < diasDelMes - 1; day++) {
            if (schedule[emp.id][day] === 'Noche' && schedule[emp.id][day + 1] === 'Vacio') {
                schedule[emp.id][day + 1] = 'Franco';
                francosCount[emp.id]++;
            }
        }
    }

    // FASE 3: REPARTIR LOS FRANCOS FALTANTES
    for (const emp of staffList) {
        let safetyLoop = 0;
        while (francosCount[emp.id] < targetFrancos && safetyLoop < 1000) {
            safetyLoop++;
            const rDay = Math.floor(Math.random() * diasDelMes);
            
            let francosHoy = 0;
            staffList.forEach(s => { if (schedule[s.id][rDay] === 'Franco') francosHoy++; });

            if (schedule[emp.id][rDay] === 'Vacio' && francosHoy < 4) {
                schedule[emp.id][rDay] = 'Franco';
                francosCount[emp.id]++;
            }
        }
    }

    // FASE 4: RELLENO DE MAÑANAS Y TARDES
    for (let day = 0; day < diasDelMes; day++) {
        let mCount = staffList.filter(s => schedule[s.id][day] === 'Mañana').length;
        let tCount = staffList.filter(s => schedule[s.id][day] === 'Tarde').length;

        for (const emp of staffList) {
            if (schedule[emp.id][day] !== 'Vacio') continue;

            const hab = emp.turnosHabilitados;
            const prev = day > 0 ? schedule[emp.id][day - 1] : 'Vacio';

            if (hab.includes('Mañana') && mCount < config.max_manana && prev !== 'Tarde') {
                schedule[emp.id][day] = 'Mañana';
                mCount++;
            } else if (hab.includes('Tarde') && tCount < config.max_tarde) {
                schedule[emp.id][day] = 'Tarde';
                tCount++;
            } else if (hab.includes('Mañana')) {
                schedule[emp.id][day] = 'Mañana'; 
            } else if (hab.includes('Tarde')) {
                schedule[emp.id][day] = 'Tarde';
            } else {
                schedule[emp.id][day] = 'Franco';
            }
        }
    }

    return schedule;
}
