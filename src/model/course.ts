import { BadRequestError, NotFoundError, UnauthorizedError } from "./error.js";
import { USER_ROLE_TYPES } from "./user.js";

export default interface Course {
    id: string;
    code: string;
    name: string;
    description?: string | null;
    semester: string;
    is_active: boolean;
    venue_latitude?: number | null;
    venue_longitude?: number | null;
    venue_name?: string | null;
    geofence_radius_meters: number;
    require_face_recognition: boolean;
    require_device_binding: boolean;
    risk_threshold: number;
    instructor_id: string | null;
    created_at: Date;
    updated_at: Date;
}

export const CourseModel = {
    getFilteredCourses: async (pgClient: any, filters: {
        is_active?: boolean | undefined;
        semester?: string | undefined;
        instructor_id?: string | undefined;
        limit?: number | undefined;
        offset?: number | undefined;
    }): Promise<{ items: Course[]; total: number }> => {
        const { is_active, semester, instructor_id, limit = 50, offset = 0 } = filters;

        let query = `SELECT c.* FROM courses c WHERE 1=1`;
        let countQuery = `SELECT COUNT(*) FROM courses c WHERE 1=1`;
        const params: any[] = [];
        const countParams: any[] = [];
        let paramIndex = 1;
        let countParamIndex = 1;

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

        if (instructor_id) {
            query += ` AND c.instructor_id = $${paramIndex++}`;
            params.push(instructor_id);
            countQuery += ` AND c.instructor_id = $${countParamIndex++}`;
            countParams.push(instructor_id);
        }

        query += ` ORDER BY c.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(limit, offset);

        const result = await pgClient.query(query, params);
        const countResult = await pgClient.query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].count);

        return {
            items: result.rows.map((row: Course) => (
                {
                    "id": row.id,
                    "code": row.code,
                    "name": row.name,
                    "semester": row.semester,
                    "instructor_id": row.instructor_id,
                    "instructor_name": "Dr. Smith",
                    "venue_name": "LT1",
                    "venue_latitude": row.venue_latitude,
                    "venue_longitude": row.venue_longitude,
                    "geofence_radius_meters": row.geofence_radius_meters,
                    "risk_threshold": row.risk_threshold,
                    "is_active": row.is_active,
                    "created_at": row.created_at
                }
            )), total
        };
    },
    findById: async (pgClient: any, id: string, user: { role: USER_ROLE_TYPES, sub: string }): Promise<Course | null> => {
        let instructor_id: string | undefined;
        // For TAs and Instructors, we only allow them to view their own courses
        if (user && (user.role === USER_ROLE_TYPES.INSTRUCTOR || user.role === USER_ROLE_TYPES.TA)) {
            instructor_id = user.sub;
        }

        const { rows } = await pgClient.query('SELECT * FROM courses WHERE id = $1', [id]);

        if (rows.length === 0) {
            throw new NotFoundError('Course not found');
        }
        const course = rows[0] as Course;
        if (course.instructor_id !== instructor_id) {
            throw new UnauthorizedError();
        }
        return course;
    },
    create: async (pgClient: any, data: {
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
        instructor_id: string;
    }): Promise<Course> => {
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
            risk_threshold = 0.5,
            instructor_id
        } = data;

        const { rows } = await pgClient.query(
            `INSERT INTO courses (
                    id, code, name, description, semester, is_active,
                    venue_latitude, venue_longitude, venue_name,
                    geofence_radius_meters, require_face_recognition, require_device_binding,
                    risk_threshold, instructor_id, created_at, updated_at
                )
                 VALUES (
                    gen_random_uuid()::text, $1, $2, $3, $4, TRUE,
                    $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW()
                 )
                 RETURNING *`,
            [
                code, name, description, semester,
                venue_latitude, venue_longitude, venue_name,
                geofence_radius_meters, require_face_recognition, require_device_binding,
                risk_threshold, instructor_id
            ]
        );

        if (rows.length === 0) {
            throw new Error('Failed to create course');
        }

        return rows[0] as Course;
    },
    update: async (pgClient: any, id: string, data: {
        name?: string;
        description?: string;
        venue_name?: string;
        venue_latitude?: number;
        venue_longitude?: number;
        geofence_radius_meters?: number;
        require_face_recognition?: boolean;
        require_device_binding?: boolean;
        risk_threshold?: number;
        instructor_id?: string | null;
    }, user: { sub: string; role: USER_ROLE_TYPES }): Promise<Course | null> => {
        // For instructors, we only allow them to edit their own courses
        if (user && user.role === USER_ROLE_TYPES.INSTRUCTOR && (data.instructor_id !== user.sub)) {
            throw new UnauthorizedError();
        }

        const fields: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        const UPDATABLE_FIELDS = [
            'name', 'description', 'venue_name', 'venue_latitude', 'venue_longitude',
            'geofence_radius_meters', 'require_face_recognition', 'require_device_binding',
            'risk_threshold', 'instructor_id'
        ];

        for (const field of UPDATABLE_FIELDS) {
            if ((data as any)[field] !== undefined) {
                fields.push(`${field} = $${paramIndex++}`);
                values.push((data as any)[field]);
            }
        }

        if (fields.length === 0) {
            throw new BadRequestError();
        }

        fields.push('updated_at = NOW()');
        values.push(id);

        const query = `UPDATE courses SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
        const { rows } = await pgClient.query(query, values);

        if (rows.length === 0) {
            throw new NotFoundError('Course not found');
        }

        return rows[0] as Course;
    },
    delete: async (pgClient: any, id: string) => {
        const result = await pgClient.query(
            `UPDATE courses SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
            [id]
        );

        if (result.rowCount === 0) {
            throw new NotFoundError('Course not found');
        }
    },
    isCourseActiveAndValid: async (pgClient: any, courseId: string): Promise<boolean> => {
        const { rows } = await pgClient.query(
            `SELECT is_active FROM courses WHERE id = $1`,
            [courseId]
        );

        if (rows.length === 0) {
            throw new NotFoundError('Course not found');
        }

        return Boolean(rows[0].is_active);
    }
}