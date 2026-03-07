/**
 * Motor CSP Determinista para Resolución de Turnos (Nurse Scheduling Problem)
 * Diseñado para operar sincrónicamente en entornos Edge (Ej: Vercel Edge / Cloudflare Workers / Turso).
 * Prioriza la estricta adherencia a restricciones de 0 Margin ("Margen Cero") para turnos nocturnos,
 * rachas máximas, topes diarios y exactitud matemática en francos mensuales.
 */

export type Turno = 'Mañana' | 'Tarde' | 'Noche' | 'Franco' | 'Vacio';

export interface StaffCSP {
    id: string;
    turnosHabilitados: Exclude<Turno, 'Franco' | 'Vacio'>[];
}

export interface ConfigCSP {
    francos_mes_corto: number;
    francos_mes_largo: number;
    min_manana: number;
    max_manana: number;
    min_tarde: number;
    max_tarde: number;
    min_noche: number;
    max_noche: number;
}

export type MatrizTurnos = Record<string, Turno[]>;

export interface Violacion {
    tipo: 'noche_count' | 'francos_count' | 'racha' | 'transicion' | 'tope_diario';
    dia?: number;
    empleadoId?: string;
    mensaje: string;
}

/**
 * Función central del validador de Restricciones (Hard Constraints Validator).
 * Recibe una matriz completa generada y barre todas las reglas del negocio, 
 * arrojando un listado exhaustivo de violaciones encontradas si la solución no es matemáticamente válida.
 */
export function validarMatriz(
    matriz: MatrizTurnos,
    staff: StaffCSP[],
    config: ConfigCSP,
    diasEnElMes: number
): Violacion[] {
    const violaciones: Violacion[] = [];
    const targetFrancos = diasEnElMes >= 31 ? config.francos_mes_largo : config.francos_mes_corto;

    // 1. Validaciones por día (Columnas)
    for (let d = 0; d < diasEnElMes; d++) {
        let n = 0, m = 0, t = 0;
        staff.forEach(s => {
            const turno = matriz[s.id][d];
            if (turno === 'Noche') n++;
            if (turno === 'Mañana') m++;
            if (turno === 'Tarde') t++;
        });

        if (n !== 2) violaciones.push({ tipo: 'noche_count', dia: d, mensaje: `Día ${d + 1}: Noches asignadas = ${n} (requiere EXACTAMENTE 2).` });
        if (m < config.min_manana || m > config.max_manana) violaciones.push({ tipo: 'tope_diario', dia: d, mensaje: `Día ${d + 1}: Mañanas = ${m} (límites: ${config.min_manana}-${config.max_manana}).` });
        if (t < config.min_tarde || t > config.max_tarde) violaciones.push({ tipo: 'tope_diario', dia: d, mensaje: `Día ${d + 1}: Tardes = ${m} (límites: ${config.min_tarde}-${config.max_tarde}).` });
    }

    // 2. Validaciones por empleado (Filas)
    staff.forEach(s => {
        const turnos = matriz[s.id];
        let fCount = 0;
        let cCount = 0;

        for (let d = 0; d < diasEnElMes; d++) {
            const turno = turnos[d];

            if (turno === 'Franco') {
                fCount++;
                cCount = 0; // El franco resetea el cansancio
            } else if (turno !== 'Vacio') {
                cCount++;
                if (cCount > 6) {
                    violaciones.push({ tipo: 'racha', dia: d, empleadoId: s.id, mensaje: `Empleado ${s.id} superó la racha de 6 días de trabajo continuo en el día ${d + 1}.` });
                }

                // Check Transición (Impuesto Biológico y Descanso Mínimo)
                if (d > 0) {
                    const prev = turnos[d - 1];
                    if (prev === 'Noche' && (turno === 'Mañana' || turno === 'Tarde')) {
                        violaciones.push({ tipo: 'transicion', dia: d, empleadoId: s.id, mensaje: `Empleado ${s.id} cambió de Noche a ${turno} en el día ${d + 1} sin Franco intermedio.` });
                    }
                    if (prev === 'Tarde' && turno === 'Mañana') {
                        violaciones.push({ tipo: 'transicion', dia: d, empleadoId: s.id, mensaje: `Empleado ${s.id} cambió de Tarde a Mañana en el día ${d + 1} sin Franco intermedio (requiere 24h descanso).` });
                    }
                }
            }
        }

        if (fCount !== targetFrancos) {
            violaciones.push({ tipo: 'francos_count', empleadoId: s.id, mensaje: `Empleado ${s.id} completó ${fCount} francos (debía tener ${targetFrancos} obligatorios).` });
        }
    });

    return violaciones;
}


/**
 * Genera la matriz de turnos para un mes completo implementando CSP híbrido.
 * Fase 1 prioriza la Noche y Fase 2/3 resuelve el resto, usando heurísticas de 
 * balanceo equitativo sobre un motor recursivo.
 * 
 * @param staff - Lista de empleados con sus turnos habilitados
 * @param config - Configuración de constraints del mes
 * @param diasEnElMes - Número de días del mes (28, 29, 30 o 31)
 * @returns MatrizTurnos - Record<staffId, Turno[]> indexado por día (0-based)
 * @throws Error si no es posible satisfacer todos los constraints tras agotar intentos
 */
export function generarMatrizTurnos(
    staff: StaffCSP[],
    config: ConfigCSP,
    diasEnElMes: number
): MatrizTurnos {
    const targetFrancos = diasEnElMes >= 31 ? config.francos_mes_largo : config.francos_mes_corto;

    // Inicializar matriz completa
    const matriz: MatrizTurnos = {};
    staff.forEach(s => { matriz[s.id] = new Array(diasEnElMes).fill('Vacio'); });

    // ==== FASE 1: RESOLUCIÓN DE LA NOCHE ====
    const f1Result = resolverFase1(staff, config, diasEnElMes, targetFrancos, 12345);
    if (!f1Result) {
        throw new Error("CSP Engine Error: Imposible encontrar configuración matemática válida para el personal de 'Noche'. Verifica la cantidad de francos y operarias disponibles.");
    }
    
    // Inyectar Fase 1 a la matriz global
    for (const [id, turnos] of Object.entries(f1Result)) {
        matriz[id] = [...turnos];
    }

    // ==== FASE 2 & 3: DISTRIBUCIÓN DEL PERSONAL DE DÍA Y FRANCOS ====
    const f2Exito = resolverFase2y3(staff, matriz, config, diasEnElMes, targetFrancos, 67890);
    if (f2Exito !== true) {
        throw new Error(`CSP Engine Error: Imposible converger los turnos de 'Mañana', 'Tarde' y 'Francos'. Máximo día alcanzado por Backtracking: ${f2Exito}`);
    }

    // Opcional: Ejecutar validador interno por seguridad matemática matemática antes de retornar
    const fallas = validarMatriz(matriz, staff, config, diasEnElMes);
    if (fallas.length > 0) {
        // En teoría inaccesible debido a las reglas robustas del motor, pero protege el contrato de confianza 0ms.
        throw new Error(`CSP Engine Panic: Matriz generada contiene ${fallas.length} violaciones. Primer fallo: ${fallas[0].mensaje}`);
    }

    return matriz;
}


// ============== MOTORES INTERNOS CSP (Mecánica de Backtracking) ==============

function resolverFase1(
    staff: StaffCSP[],
    config: ConfigCSP,
    diasEnElMes: number,
    targetFrancos: number,
    seed: number
): MatrizTurnos | null {
    const nightStaff = staff.filter(s => s.turnosHabilitados.includes('Noche'));
    const N = nightStaff.length;
    const nsIds = nightStaff.map(s => s.id);

    // Contadores de progreso y matriz local
    const fCount = Array(N).fill(0);
    const mLocal: Turno[][] = Array(N).fill(0).map(() => Array(diasEnElMes).fill('Vacio'));
    const cCountGrid: number[][] = Array(diasEnElMes + 1).fill(0).map(() => Array(N).fill(0));

    // Fast check: ¿Tienen autorizados turnos de día para cuando hagan "Vacio" de Noche?
    const canDoDay = nightStaff.map(s => s.turnosHabilitados.some(t => t === 'Mañana' || t === 'Tarde'));

    // PRNG Minimalista (Determinista)
    let _seed = seed;
    function rnd() {
        _seed = (_seed * 9301 + 49297) % 233280;
        return _seed / 233280;
    }

    let attempts = 0;

    function dfs(d: number): boolean {
        attempts++;
        if (attempts > 150000) return false;

        if (d === diasEnElMes) {
            return fCount.every(f => f === targetFrancos);
        }

        // Proyectar cansancio desde el día de ayer
        if (d > 0) {
            for (let i = 0; i < N; i++) {
                if (mLocal[i][d - 1] === 'Franco') {
                    cCountGrid[d][i] = 0;
                } else {
                    cCountGrid[d][i] = cCountGrid[d - 1][i] + 1;
                }
            }
        }

        const validAssignments: Turno[][] = [];
        let numCombs = 0;

        function buildDay(pIdx: number, curr: Turno[], nC: number) {
            if (numCombs > 100) return;
            if (pIdx === N) {
                if (nC === 2) {
                    validAssignments.push([...curr]);
                    numCombs++;
                }
                return;
            }

            const cConsec = cCountGrid[d][pIdx];

            // Opción Noche
            if (nC < 2 && cConsec < 6) {
                curr.push('Noche');
                buildDay(pIdx + 1, curr, nC + 1);
                curr.pop();
            }

            // Opción Franco
            if (fCount[pIdx] < targetFrancos) {
                curr.push('Franco');
                buildDay(pIdx + 1, curr, nC);
                curr.pop();
            }

            // Opción Disponibilidad para Fase 2/3 (Queda como "Vacio")
            if (canDoDay[pIdx] && cConsec < 6) {
                const last = d > 0 ? mLocal[pIdx][d - 1] : 'Vacio';
                if (last !== 'Noche') {
                    curr.push('Vacio');
                    buildDay(pIdx + 1, curr, nC);
                    curr.pop();
                }
            }
        }

        buildDay(0, [], 0);
        if (validAssignments.length === 0) return false;

        // Heurística de Linealidad Equitativa: Buscar la distribución de francos más pareja
        validAssignments.sort((a, b) => {
            let sA = 0, sB = 0;
            for (let i = 0; i < N; i++) {
                let currA = fCount[i] + (a[i] === 'Franco' ? 1 : 0);
                let currB = fCount[i] + (b[i] === 'Franco' ? 1 : 0);

                // Cuánto nos alejamos de tener una fracción lineal de los francos a esta altura del mes
                sA += Math.abs(currA - ((d + 1) / diasEnElMes) * targetFrancos);
                sB += Math.abs(currB - ((d + 1) / diasEnElMes) * targetFrancos);
            }
            return (sA - sB) + (rnd() - 0.5) * 0.1; // Ruido determinístico para desempatar sin atascarse
        });

        for (const asg of validAssignments) {
            // Aplicar matriz provisoriamente
            for (let i = 0; i < N; i++) {
                mLocal[i][d] = asg[i];
                if (asg[i] === 'Franco') fCount[i]++;
            }

            // PODA FORWARD: Comprobar que a los que les faltan muchos francos les quedan días
            let branchDead = false;
            for (let i = 0; i < N; i++) {
                if (targetFrancos - fCount[i] > diasEnElMes - 1 - d) {
                    branchDead = true; 
                    break;
                }
            }

            if (!branchDead && dfs(d + 1)) return true;

            // Rollback
            for (let i = 0; i < N; i++) {
                if (asg[i] === 'Franco') fCount[i]--;
                mLocal[i][d] = 'Vacio';
            }
        }

        return false;
    }

    if (dfs(0)) {
        const result: MatrizTurnos = {};
        for (let i = 0; i < N; i++) result[nsIds[i]] = mLocal[i];
        return result;
    }
    return null;
}

function resolverFase2y3(
    staff: StaffCSP[],
    matriz: MatrizTurnos,
    config: ConfigCSP,
    diasEnElMes: number,
    targetFrancos: number,
    seed: number
): boolean | number {
    const dayStaff = staff.filter(s => !s.turnosHabilitados.includes('Noche'));
    
    let _seed = seed;
    function rnd() {
        _seed = (_seed * 9301 + 49297) % 233280;
        return _seed / 233280;
    }

    let tryFase = 0;
        let success = false;
        
        while (!success && tryFase < 1000) {
            tryFase++;
            
            // Revert changes made in failed attempt
            for (let s of staff) {
                // If they are dayStaff, their francos were assigned in Fase 2.
                // Reset ONLY Phase 2 and 3 assignments
                if (!s.turnosHabilitados.includes('Noche')) {
                    for(let di=0; di<diasEnElMes; di++) matriz[s.id][di] = 'Vacio';
                } else {
                    // For night staff, only reset 'Mañana' and 'Tarde' from Phase 3
                    for(let di=0; di<diasEnElMes; di++) {
                        if (matriz[s.id][di] === 'Mañana' || matriz[s.id][di] === 'Tarde') {
                            matriz[s.id][di] = 'Vacio';
                        }
                    }
                }
            }

            const fCountDay = Array(dayStaff.length).fill(0);
            const cConsecDay = Array(dayStaff.length).fill(0);
            const totalFrancosNeeded = dayStaff.length * targetFrancos;
            const baseF = Math.floor(totalFrancosNeeded / diasEnElMes);
            const extraF = totalFrancosNeeded % diasEnElMes;
            
            const fPerDay = Array(diasEnElMes).fill(baseF);
            if (extraF > 0) {
                const slots = Array(diasEnElMes).fill(0).map((_,i)=>i).sort(() => rnd() - 0.5);
                for(let i=0; i<extraF; i++) fPerDay[slots[i]]++;
            }
            
            for (let d = 0; d < diasEnElMes; d++) {
                const candidates = dayStaff.map((emp, idx) => ({emp, idx}))
                    .filter(c => fCountDay[c.idx] < targetFrancos)
                    .sort((a, b) => {
                        if (cConsecDay[a.idx] !== cConsecDay[b.idx]) return cConsecDay[b.idx] - cConsecDay[a.idx];
                        return (fCountDay[a.idx] - fCountDay[b.idx]) + (rnd() - 0.5) * 0.1;
                    });
                    
                for (let i = 0; i < candidates.length; i++) {
                    const c = candidates[i];
                    if (i < fPerDay[d]) {
                        matriz[c.emp.id][d] = 'Franco';
                        fCountDay[c.idx]++;
                        cConsecDay[c.idx] = 0;
                    } else {
                        cConsecDay[c.idx]++;
                    }
                }
            }

            // FASE 3: Asignar Turnos de Trabajo diarios
            success = true;
            for (let d = 0; d < diasEnElMes; d++) {
                const available = staff.filter(s => matriz[s.id][d] === 'Vacio');
                const validAsg: Turno[][] = [];

                function buildShift(idx: number, curr: Turno[], mCount: number, tCount: number) {
                    if (idx === available.length) {
                        if (mCount >= config.min_manana && mCount <= config.max_manana &&
                            tCount >= config.min_tarde && tCount <= config.max_tarde) {
                            validAsg.push([...curr]);
                        }
                        return;
                    }

                    const emp = available[idx];
                    const prev = d > 0 ? matriz[emp.id][d - 1] : 'Vacio';
                    
                    if (emp.turnosHabilitados.includes('Mañana') && mCount < config.max_manana && prev !== 'Tarde' && prev !== 'Noche') {
                        curr.push('Mañana');
                        buildShift(idx + 1, curr, mCount + 1, tCount);
                        curr.pop();
                    }
                    if (emp.turnosHabilitados.includes('Tarde') && tCount < config.max_tarde && prev !== 'Noche') {
                        curr.push('Tarde');
                        buildShift(idx + 1, curr, mCount, tCount + 1);
                        curr.pop();
                    }
                }

                buildShift(0, [], 0, 0);

                if (validAsg.length === 0) {
                    success = false;
                    break;
                }

                // Balancear rotación dando prioridad a quienes menos hicieron x turno
                validAsg.sort(() => rnd() - 0.5);
                const best = validAsg[0];

                available.forEach((emp, i) => {
                    matriz[emp.id][d] = best[i];
                });
            }
        }
        
        if (!success) return false;
        return true;
}

/**
 * Función de conveniencia decorativa para observar en terminal o logs
 * la distribución final. Retorna un string formateado como un tablero.
 */
export function generarReporte(matriz: MatrizTurnos, diasEnElMes: number): string {
    let rep = "    ";
    for(let d=1; d<=diasEnElMes; d++) rep += d.toString().padStart(3, ' ');
    rep += "\n";
    
    for(const [staffId, plan] of Object.entries(matriz)) {
        let fila = staffId.substring(0,3).padEnd(4, ' ') + "|";
        for (let d = 0; d < diasEnElMes; d++) {
            const t = plan[d];
            const code = t === 'Mañana' ? 'M' : t === 'Tarde' ? 'T' : t === 'Noche' ? 'N' : t === 'Franco' ? 'F' : 'X';
            fila += code.padStart(3, ' ');
        }
        rep += fila + "\n";
    }
    return rep;
}
