export type Course = {
    id: string;
    code: string;
    name: string;
    description?: string;
    semester: string;
    is_active: boolean;
    venue_latitude?: number;
    venue_longitude?: number;
    venue_name: string;
    geofence_radius_meters: number;
    require_face_recognition: boolean;
    require_device_binding: boolean;
    risk_threshold: number;
    created_at: Date;
    updated_at: Date;
}