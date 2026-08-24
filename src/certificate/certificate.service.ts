import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, ILike } from "typeorm";
import { Certificate } from "./entities/certificate.entity";
import { CreateCertificateDto } from "./dto/create-certificate.dto";

import * as puppeteer from "puppeteer";
import * as fs from "fs";
import * as path from "path";
import * as QRCode from "qrcode";

@Injectable()
export class CertificateService {
  constructor(
    @InjectRepository(Certificate)
    private certificateRepo: Repository<Certificate>,
  ) {}

  async generateNumber(): Promise<string> {
    const count = await this.certificateRepo.count();

    const number = String(count + 1).padStart(3, "0");

    const date = new Date();
    const month = date.toLocaleString("id-ID", { month: "2-digit" });
    const year = date.getFullYear();

    return `${number}/ANID/${month}/${year}`;
  }

  private formatDate(date: Date | string): string {
    const d = new Date(date);
    return d.toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  /**
   * ✂️ Bersihkan input dari tag HTML/JavaScript untuk cegah XSS
   */
  private sanitize(input: string): string {
    if (!input) return input;
    return input.replace(/<[^>]*>/g, ""); // strip all HTML tags
  }

  async create(dto: CreateCertificateDto) {
    const certificate_number = await this.generateNumber();

    // 🛡️ Sanitasi semua input teks untuk mencegah Stored XSS
    const sanitizedName = this.sanitize(dto.name);
    const sanitizedSchool = this.sanitize(dto.school);
    const sanitizedReason = dto.reason ? this.sanitize(dto.reason) : undefined;

    const certificate = this.certificateRepo.create({
      name: sanitizedName,
      school: sanitizedSchool,
      start_date: dto.start_date,
      end_date: dto.end_date,
      certificate_number,
      status: dto.status,
      reason: dto.status === "lainnya" ? sanitizedReason : undefined,
    });

    const saved: Certificate = await this.certificateRepo.save(certificate);

    // ❗ kalau status gagal → skip generate PDF
    if (dto.status === "gagal") {
      return saved;
    }

    // ✅ hanya generate kalau bukan gagal, oper tanggal juga ke method generatePdf
    const pdf_url = await this.generatePdf(
      sanitizedName,
      certificate_number,
      saved.id,
      saved.start_date,
      saved.end_date
    );

    saved.pdf_url = pdf_url;

    return this.certificateRepo.save(saved);
  }

  async findAll() {
    return this.certificateRepo.find({
      order: { created_at: "DESC" },
    });
  }

  async findOneById(id: string) {
    return this.certificateRepo.findOne({
      where: { id },
    });
  }

  // ✅ Tambahkan parameter startDate dan endDate di sini
  async generatePdf(name: string, number: string, id: string, startDate: Date, endDate: Date) {
    const templatePath = path.join(process.cwd(), "templates", "certificate.html");
    const templateImage = path.join(process.cwd(), "templates", "certificate.png");

    let html = fs.readFileSync(templatePath, "utf8");

    const imageBuffer = fs.readFileSync(templateImage);
    const imageBase64 = imageBuffer.toString("base64");
    const imageSrc = `data:image/png;base64,${imageBase64}`;

    // URL untuk verifikasi
    const verifyUrl = `https://staging.anandam.id/certificate/${id}`;

    // generate QR base64
    const qrBase64 = await QRCode.toDataURL(verifyUrl);

    // Format periode tanggal
    const period = `${this.formatDate(startDate)} - ${this.formatDate(endDate)}`;

    html = html
      .replace("{{name}}", name)
      .replace("{{number}}", number)
      .replace("{{period}}", period) // ✅ Inject periode ke HTML
      .replace("{{template}}", imageSrc)
      .replace("{{qr}}", qrBase64);

    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    await page.setContent(html);

    const fileName = `${number.replace(/\//g, "-")}.pdf`;

    const pdfPath = path.join(process.cwd(), "uploads", "certificates", fileName);

    await page.pdf({
      path: pdfPath,
      format: "A4",
      landscape: true,
      printBackground: true,
    });

    await browser.close();

    return `/uploads/certificates/${fileName}`;
  }

  async search(q: string) {
    const query = q.trim();

    if (!query) return [];

    return this.certificateRepo.find({
      where: [
        { certificate_number: ILike(`%${query}%`) },
        { name: ILike(`%${query}%`) },
      ],
      order: {
        created_at: "DESC",
      },
    });
  }
}