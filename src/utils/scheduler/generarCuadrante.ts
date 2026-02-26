export interface Staff {
    id: string;
    nombre: string;
    rol: string;
}

export interface ReglaDisponibilidad {
    id?: string;
    staff_id: string;
    fecha: string; // YYYY-MM-DD
    tipo: string;
}

export interface TurnoAsignado {
    dia: string; // YYYY-MM-DD
    turno: "Mañana" | "Tarde" | "Noche";
    staff_id: string;
}

/**
 * Genera el cuadrante de un mes completo cumpliendo las reglas de negocio (CSP).
 * @param anio Año objetivo (ej: 2026)
 * @param mes Mes objetivo (1-12)
 * @param staffList Lista de empleados disponibles
 * @param reglas Reglas de excepciones y francos
 * @returns Array de TurnoAsignado que conforman el mes entero
 */
export function generarCuadrante(
    anio: number,
    mes: number,
    staffList: Staff[],
    reglas: ReglaDisponibilidad[]
): TurnoAsignado[] {
    const asignaciones: TurnoAsignado[] = [];
    const diasEnElMes = new Date(anio, mes, 0).getDate();

    // Para balanceo básico, mantenemos un contador de turnos asignados a cada empleado
    const turnosPorEmpleado: Record<string, number> = {};
    staffList.forEach((s) => (turnosPorEmpleado[s.id] = 0));

    const turnosDelDia: ("Mañana" | "Tarde" | "Noche")[] = ["Mañana", "Tarde", "Noche"];

    for (let dia = 1; dia <= diasEnElMes; dia++) {
        const diaString = `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
        const diaAnteriorString = dia > 1
            ? `${anio}-${String(mes).padStart(2, "0")}-${String(dia - 1).padStart(2, "0")}`
            : null; // Simplificación: no miramos el mes anterior en este CSP básico

        // Ver si alguien trabajó la Noche del día anterior
        const turnoNocheAyer = diaAnteriorString
            ? asignaciones.find(a => a.dia === diaAnteriorString && a.turno === "Noche")
            : null;

        for (const turno of turnosDelDia) {
            // Ordenamos staff iterativamente para distribuir los turnos equitativamente
            // priorizando a quienes tengan menos turnos.
            const staffDisponibles = [...staffList].sort((a, b) => turnosPorEmpleado[a.id] - turnosPorEmpleado[b.id]);

            let asignado = false;

            for (const candidato of staffDisponibles) {
                // Regla 1: Descanso legal (Noche -> Mañana prohibido)
                if (turno === "Mañana" && turnoNocheAyer && turnoNocheAyer.staff_id === candidato.id) {
                    continue; // No puede hacer mañana si hizo la noche ayer
                }

                // Regla 1.1: No puede hacer más de un turno por día (para no pisarse)
                const yaTrabajaHoy = asignaciones.some(a => a.dia === diaString && a.staff_id === candidato.id);
                if (yaTrabajaHoy) {
                    continue;
                }

                // Regla 2: Francos y Excepciones
                const tieneFranco = reglas.some(r => r.staff_id === candidato.id && r.fecha === diaString);
                if (tieneFranco) {
                    continue; // Tiene franco o excepción aprobada
                }

                // Si pasa todas las reglas, asignamos
                asignaciones.push({
                    dia: diaString,
                    turno: turno,
                    staff_id: candidato.id
                });
                turnosPorEmpleado[candidato.id]++;
                asignado = true;
                break;
            }

            if (!asignado) {
                console.warn(`No se encontró staff disponible para el turno ${turno} del día ${diaString}`);
                // Según requerimientos estrictos faltaría manejo de fallas si el constraint solver no resuelve
                // por ahora dejamos el turno sin asignar (o podríamos lanzar error).
            }
        }
    }

    return asignaciones;
}
