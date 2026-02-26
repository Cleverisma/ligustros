export interface Staff {
    id: string;
    nombre: string;
    rol: string;
    turno_preferido?: 'Mañana' | 'Tarde' | 'Noche';
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
