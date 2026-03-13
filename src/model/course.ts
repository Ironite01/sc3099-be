export interface CourseCreateData {
    code: string;
    name: string;
    semester: string;
    description?: string | null;
    venue_name?: string | null;
    venue_latitude?: number | null;
    venue_longitude?: number | null;
    geofence_radius_meters?: number;
    require_face_recognition?: boolean;
    require_device_binding?: boolean;
    risk_threshold?: number;
}

export interface CourseUpdateData {
    name?: string;
    description?: string;
    venue_name?: string;
    venue_latitude?: number;
    venue_longitude?: number;
    geofence_radius_meters?: number;
    require_face_recognition?: boolean;
    require_device_binding?: boolean;
    risk_threshold?: number;
    is_active?: boolean;
}

export interface CourseListFilters {
    is_active?: boolean | undefined;
    semester?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
}

const UPDATABLE_FIELDS = [
    'name', 'description', 'venue_name', 'venue_latitude', 'venue_longitude',
    'geofence_radius_meters', 'require_face_recognition', 'require_device_binding',
    'risk_threshold', 'is_active'
];

export class Course {
    id!: string;
    code!: string;
    name!: string;
    description!: string | null;
    semester!: string;
    is_active!: boolean;
    venue_latitude!: number | null;
    venue_longitude!: number | null;
    venue_name!: string | null;
    geofence_radius_meters!: number;
    require_face_recognition!: boolean;
    require_device_binding!: boolean;
    risk_threshold!: number;
    created_at!: Date;
    updated_at!: Date;

    constructor(row: any) {
        Object.assign(this, row);
    }

    /**
     * List courses with filters. Students only see enrolled courses.
     */
    static async findAll(pgClient: any, filters: CourseListFilters, user: { id: string, role: string }): Promise<{ items: any[], total: number }> {
        const { is_active, semester, limit = 50, offset = 0 } = filters;

        let query = `SELECT c.* FROM courses c`;
        let countQuery = `SELECT COUNT(*) FROM courses c`;
        const params: any[] = [];
        const countParams: any[] = [];
        let paramIndex = 1;
        let countParamIndex = 1;

        // Students only see courses they are enrolled in
        if (user.role === 'student') {
            const joinClause = ` INNER JOIN enrollments e ON e.course_id = c.id AND e.student_id = $${paramIndex++} AND e.is_active = TRUE`;
            query += joinClause;
            params.push(user.id);
            const countJoin = ` INNER JOIN enrollments e ON e.course_id = c.id AND e.student_id = $${countParamIndex++} AND e.is_active = TRUE`;
            countQuery += countJoin;
            countParams.push(user.id);
        }

        query += ` WHERE 1=1`;
        countQuery += ` WHERE 1=1`;

        if (is_active !== undefined) {
            query += ` AND c.is_active = $${paramIndex++}`;
            params.push(is_active);
            countQuery += ` AND c.is_active = $${countParamIndex++}`;
            countParams.push(is_active);
        }
        if (semester) {
            query += ` AND c.semester = $${paramIndex++}`;
            params.push(semester);
            countQuery += ` AND c.semester = $${countParamIndex++}`;
            countParams.push(semester);
        }

        query += ` ORDER BY c.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(limit, offset);

        const result = await pgClient.query(query, params);
        const countResult = await pgClient.query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].count);

        return { items: result.rows, total };
    }

    /**
     * Find a single course by ID.
     */
    static async findById(pgClient: any, id: string): Promise<Course | null> {
        const result = await pgClient.query(
            'SELECT * FROM courses WHERE id = $1',
            [id]
        );
        return result.rows.length > 0 ? new Course(result.rows[0]) : null;
    }

    /**
     * Create a new course.
     */
    static async create(pgClient: any, data: CourseCreateData): Promise<Course> {
        const {
            code,
            name,
            semester,
            description = null,
            venue_name = null,
            venue_latitude = null,
            venue_longitude = null,
            geofence_radius_meters = 100.0,
            require_face_recognition = false,
            require_device_binding = true,
            risk_threshold = 0.5
        } = data;

        const result = await pgClient.query(
            `INSERT INTO courses (
                id, code, name, description, semester, is_active,
                venue_latitude, venue_longitude, venue_name,
                geofence_radius_meters, require_face_recognition, require_device_binding,
                risk_threshold, created_at, updated_at
            )
             VALUES (
                gen_random_uuid()::text, $1, $2, $3, $4, TRUE,
                $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()
             )
             RETURNING *`,
            [
                code, name, description, semester,
                venue_latitude, venue_longitude, venue_name,
                geofence_radius_meters, require_face_recognition, require_device_binding,
                risk_threshold
            ]
        );

        return new Course(result.rows[0]);
    }

    /**
     * Update a course by ID. Only updates fields that are provided.
     */
    static async update(pgClient: any, id: string, data: CourseUpdateData): Promise<Course | null> {
        const fields: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        for (const field of UPDATABLE_FIELDS) {
            if ((data as any)[field] !== undefined) {
                fields.push(`${field} = $${paramIndex++}`);
                values.push((data as any)[field]);
            }
        }

        if (fields.length === 0) {
            throw new Error('No valid fields to update');
        }

        fields.push(`updated_at = NOW()`);
        values.push(id);

        const query = `UPDATE courses SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
        const result = await pgClient.query(query, values);

        return result.rows.length > 0 ? new Course(result.rows[0]) : null;
    }

    /**
     * Soft delete a course (set is_active = false) and cancel its active sessions.
     */
    static async delete(pgClient: any, id: string): Promise<boolean> {
        const result = await pgClient.query(
            `UPDATE courses SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id`,
            [id]
        );

        if (result.rows.length === 0) {
            return false;
        }

        // Cancel all scheduled/active sessions for this course
        await pgClient.query(
            `UPDATE sessions 
             SET status = 'cancelled', updated_at = NOW() 
             WHERE course_id = $1 AND status IN ('scheduled', 'active')`,
            [id]
        );

        return true;
    }
}
