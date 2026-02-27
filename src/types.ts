export interface Staff {
    id: string;
    nombre: string;
    rol: string;
    turno_preferido?: 'Mañana' | 'Tarde' | 'Noche';
    modalidad_turno?: 'M' | 'T' | 'N' | 'MIXTO';
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

export interface ConfiguracionGlobal {
    id: string; // 'default'
    francos_mes_corto: number;
    francos_mes_largo: number;
    min_manana: number;
    max_manana: number;
    min_tarde: number;
    max_tarde: number;
    min_noche: number;
    max_noche: number;
}
