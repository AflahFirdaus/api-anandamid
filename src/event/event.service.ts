import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { randomUUID } from 'crypto';
import { Event, EventStatus } from './entities/event.entity';
import {
  EventResponse,
  ResponseStatus,
} from './entities/event-response.entity';
import { CreateEventDto } from './dto/create-event.dto';
import { SubmitEventResponseDto } from './dto/submit-event-response.dto';

type UploadedEventFiles = {
  proof_of_follow?: Express.Multer.File[];
  proof_of_review?: Express.Multer.File[];
};

@Injectable()
export class EventService {
  private readonly logger = new Logger(EventService.name);

  constructor(
    @InjectRepository(Event)
    private readonly eventRepository: Repository<Event>,
    @InjectRepository(EventResponse)
    private readonly responseRepository: Repository<EventResponse>,
  ) {}

  // ──────────────────────────────────────────────
  //  ADMIN: Buat event baru
  // ──────────────────────────────────────────────
  async createEvent(dto: CreateEventDto): Promise<Event> {
    let slug = dto.slug?.trim().toLowerCase();
    if (!slug) {
      slug = this.generateSlug(dto.title);
    }

    if (!slug) {
      throw new BadRequestException('Slug tidak valid. Periksa judul event.');
    }

    // Jaga keunikan slug — jika bentrok, tambahkan suffix acak pendek
    const existing = await this.eventRepository.findOne({ where: { slug } });
    if (existing) {
      slug = `${slug}-${randomUUID().slice(0, 8)}`;
    }

    const event = this.eventRepository.create({
      ...dto,
      slug,
      status: dto.status ?? EventStatus.DRAFT,
    });

    return this.eventRepository.save(event);
  }

  // ──────────────────────────────────────────────
  //  ADMIN: Daftar semua event
  // ──────────────────────────────────────────────
  findAllEvents(): Promise<Event[]> {
    return this.eventRepository.find({
      order: { created_at: 'DESC' },
    });
  }

// ──────────────────────────────────────────────
  //  PUBLIC: Daftar semua event yang sudah published
  // ──────────────────────────────────────────────
  findAllPublishedEvents(): Promise<Event[]> {
    return this.eventRepository.find({
      where: { status: EventStatus.PUBLISHED },
      order: { event_date: 'ASC' },
    });
  }
  // ──────────────────────────────────────────────
  //  ADMIN: Detail satu event
  // ──────────────────────────────────────────────
  async findEventById(id: string): Promise<Event> {
    const event = await this.eventRepository.findOne({ where: { id } });
    if (!event) {
      throw new NotFoundException('Event tidak ditemukan');
    }
    return event;
  }
  // ──────────────────────────────────────────────
  //  ADMIN: Semua pendaftar pada sebuah event
  // ──────────────────────────────────────────────
  async findEventResponses(eventId: string): Promise<EventResponse[]> {
    // Lempar 404 bila event tidak ada
    await this.findEventById(eventId);

    return this.responseRepository.find({
      where: { event_id: eventId },
      order: { created_at: 'DESC' },
      relations: { event: true },
    });
  }

  // ──────────────────────────────────────────────
  //  ADMIN: Ubah status pendaftar (Pending → Approved/Rejected)
  // ──────────────────────────────────────────────
  async updateResponseStatus(
    responseId: string,
    status: ResponseStatus,
  ): Promise<EventResponse> {
    const response = await this.responseRepository.findOne({
      where: { id: responseId },
    });
    if (!response) {
      throw new NotFoundException('Pendaftar tidak ditemukan');
    }

    response.status = status;
    return this.responseRepository.save(response);
  }

  // ──────────────────────────────────────────────
  //  ADMIN: Ubah status event (draft ↔ published)
  // ──────────────────────────────────────────────
  async updateEventStatus(
    id: string,
    status: EventStatus,
  ): Promise<Event> {
    const event = await this.findEventById(id);
    event.status = status;
    return this.eventRepository.save(event);
  }

  // ──────────────────────────────────────────────
  //  ADMIN: Simpan/update poster event
  // ──────────────────────────────────────────────
  async setEventPoster(id: string, posterUrl: string): Promise<Event> {
    const event = await this.findEventById(id);
    event.poster_url = posterUrl;
    return this.eventRepository.save(event);
  }

  // ──────────────────────────────────────────────
  //  ADMIN: Update data event
  // ──────────────────────────────────────────────
  async updateEvent(
    id: string,
    dto: Partial<CreateEventDto>,
  ): Promise<Event> {
    const event = await this.findEventById(id);

    if (dto.slug !== undefined) {
      const slug = dto.slug.trim().toLowerCase();
      if (!slug) {
        throw new BadRequestException('Slug tidak valid.');
      }
      const existing = await this.eventRepository.findOne({
        where: { slug },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('Slug sudah digunakan oleh event lain.');
      }
      event.slug = slug;
    }

    if (dto.title !== undefined) event.title = dto.title;
    if (dto.description !== undefined) event.description = dto.description;
    if (dto.rules !== undefined) event.rules = dto.rules;
    if (dto.registration_start !== undefined)
      event.registration_start = new Date(dto.registration_start);
    if (dto.registration_end !== undefined)
      event.registration_end = new Date(dto.registration_end);
    if (dto.event_date !== undefined)
      event.event_date = new Date(dto.event_date);
    if (dto.location_name !== undefined) event.location_name = dto.location_name;
    if (dto.location_url !== undefined)
      event.location_url = dto.location_url || null;
    if (dto.max_quota !== undefined)
      event.max_quota = dto.max_quota ?? null;
    if (dto.additional_notes_label !== undefined)
      event.additional_notes_label = dto.additional_notes_label || null;
    if (dto.status !== undefined) event.status = dto.status;

    return this.eventRepository.save(event);
  }

  // ──────────────────────────────────────────────
  //  PUBLIC: Detail event berdasarkan slug (hanya published)
  // ──────────────────────────────────────────────
  async findPublishedEventBySlug(slug: string): Promise<Event> {
    const event = await this.eventRepository.findOne({
      where: { slug, status: EventStatus.PUBLISHED },
    });
    if (!event) {
      throw new NotFoundException(
        'Event tidak ditemukan atau belum dipublikasikan',
      );
    }
    return event;
  }

  // ──────────────────────────────────────────────
  //  PUBLIC: Submit pendaftaran (multipart + 2 file bukti)
  // ──────────────────────────────────────────────
  async submitResponse(
    slug: string,
    files: UploadedEventFiles,
    dto: SubmitEventResponseDto,
  ): Promise<EventResponse> {
    // 1. Event wajib exist & published
    const event = await this.findPublishedEventBySlug(slug);

    // 2. Cek window pendaftaran
    const now = new Date();
    if (
      now < new Date(event.registration_start) ||
      now > new Date(event.registration_end)
    ) {
      throw new BadRequestException(
        'Pendaftaran event belum dibuka atau sudah ditutup',
      );
    }

    // 3. Kedua file bukti wajib ada
    const proofOfFollow = files?.proof_of_follow?.[0];
    const proofOfReview = files?.proof_of_review?.[0];
    if (!proofOfFollow || !proofOfReview) {
      throw new BadRequestException(
        'Bukti follow (proof_of_follow) dan bukti review (proof_of_review) wajib diunggah',
      );
    }

    // 4. Cek kuota (hanya jika max_quota diisi). Pendaftar Pending/Approved
    //    dianggap mengisi slot; yang Rejected tidak.
    if (event.max_quota != null && event.max_quota > 0) {
      const confirmedCount = await this.responseRepository.count({
        where: {
          event_id: event.id,
          status: Not(ResponseStatus.REJECTED),
        },
      });

      if (confirmedCount >= event.max_quota) {
        throw new BadRequestException(
          'Maaf, kuota pendaftaran event ini sudah penuh',
        );
      }
    }

    // 5. Simpan data pendaftar
    const response = this.responseRepository.create({
      event_id: event.id,
      name: dto.name,
      phone: dto.phone,
      email: dto.email,
      ig_account: dto.ig_account,
      address: dto.address,
      additional_notes_answer: dto.additional_notes_answer ?? null,
      proof_of_follow_url: `/uploads/events/${proofOfFollow.filename}`,
      proof_of_review_url: `/uploads/events/${proofOfReview.filename}`,
      status: ResponseStatus.PENDING,
    });

    return this.responseRepository.save(response);
  }

  // ──────────────────────────────────────────────
  //  HELPER: Ubah judul menjadi slug
  // ──────────────────────────────────────────────
  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
