import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx-js-style';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Product } from '../product/entities/product.entity';
import { Category } from '../category/entities/category.entity';
import { ProductImage } from '../product-image/entities/product-image.entity';
import { Brand } from '../brand/entities/brand.entity';
import { ProductVariant } from '../product/entities/product-variant.entity'; 
import { randomUUID } from 'crypto';
import { ProductService } from 'src/product/product.service';
import { ProductImportProgressService } from './product-import-progress.service';

@Injectable()
export class ProductImportService {
  private readonly logger = new Logger(ProductImportService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,

    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,

    @InjectRepository(ProductImage)
    private readonly productImageRepo: Repository<ProductImage>,

    @InjectRepository(Brand)
    private readonly brandRepo: Repository<Brand>,

    private readonly progressService: ProductImportProgressService,

    private readonly productService: ProductService,
  ) {}

  // Helper untuk mengambil list Socket & RAM unik dari DB
  private async getDistinctTypes() {
    const rawSockets = await this.productRepo
      .createQueryBuilder("product")
      .select("product.socket_type", "val")
      .distinct(true)
      .where("product.socket_type IS NOT NULL")
      .andWhere("product.socket_type != ''")
      .getRawMany();
    
    const rawRams = await this.productRepo
      .createQueryBuilder("product")
      .select("product.ram_type", "val")
      .distinct(true)
      .where("product.ram_type IS NOT NULL")
      .andWhere("product.ram_type != ''")
      .getRawMany();

    return {
      sockets: rawSockets.map(r => r.val),
      rams: rawRams.map(r => r.val)
    };
  }

  // ==========================
  // GENERATE TEMPLATE UPLOAD
  // ==========================
  async generateTemplate(): Promise<Buffer> {
    const headers = [
      'id',
      'name', 'description', 
      'variant_type_name', 'variant_name', // 🔥 Kolom Variasi
      'price_normal', 'price_discount', 'stock', 'sku_seller',
      'warranty', 'brand_name', 'category_name', 'category_code',
      'socket_type', 'ram_type', 
      'is_active', 'is_popular',
      'image_1', 'image_2', 'image_3', 'image_4', 'image_5', 'image_6', 'image_7', 'image_8', 'image_9', 'image_10'
    ];

    const exampleRow1 = [
      '', 
      'PRINTER CANON PIXMA G2010', 'Deskripsi produk disini...', 
      '', 'Default',
      2125000, 100000, 48, '1102127',
      'Garansi Produsen', 'Canon', 'Printer & Scanner', '830984',
      '', '', 
      true, false,
      'https://example.com/image1.jpg', '', '', '', '', '', '', '', '', ''
    ];

    const exampleRow2_Var1 = [
      '', 
      'MOUSE WIRELESS LOGITECH', 'Mouse nyaman banget...', 
      'Warna', 'Merah',
      150000, 0, 10, 'MS-LOG-MERAH',
      'Garansi 1 Tahun', 'Logitech', 'Aksesoris Komputer', 'AK001',
      '', '', 
      true, true,
      'https://example.com/mouse-merah-depan.jpg', 'https://example.com/mouse-merah-samping.jpg', '', '', '', '', '', '', '', ''
    ];
    const exampleRow2_Var2 = [
      '', 
      '', '', // Kosongkan nama & deskripsi, otomatis gabung ke MOUSE LOGITECH
      'Warna', 'Biru',
      150000, 0, 15, 'MS-LOG-BIRU',
      '', '', '', '', 
      '', '', 
      '', '',
      'https://example.com/mouse-biru.jpg', '', '', '', '', '', '', '', '', ''
    ];

    const productSheet = XLSX.utils.aoa_to_sheet([headers, exampleRow1, exampleRow2_Var1, exampleRow2_Var2]);
    productSheet['!views'] = [{ state: 'frozen', ySplit: 1 }];

    headers.forEach((_, colIndex) => {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: colIndex });
      if (!productSheet[cellAddress]) return;
      productSheet[cellAddress].s = { font: { bold: true }, fill: { fgColor: { rgb: "D9E1F2" } } };
    });

    const categories = await this.categoryRepo.find({ order: { name: "ASC" } });
    const categorySheet = XLSX.utils.aoa_to_sheet([
      ["category_name", "category_code"],
      ...categories.map(c => [c.name, c.code])
    ]);

    const brands = await this.brandRepo.find({ order: { name: "ASC" } });
    const brandSheet = XLSX.utils.aoa_to_sheet([
      ["brand_name"],
      ...brands.map(b => [b.name])
    ]);

    const { sockets, rams } = await this.getDistinctTypes();
    const finalSockets = sockets.length > 0 ? sockets : ['LGA 1700', 'AM4', 'AM5'];
    const finalRams = rams.length > 0 ? rams : ['DDR4', 'DDR5'];

    const socketSheet = XLSX.utils.aoa_to_sheet([["socket_type"], ...finalSockets.map(s => [s])]);
    const ramSheet = XLSX.utils.aoa_to_sheet([["ram_type"], ...finalRams.map(r => [r])]);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, productSheet, "Products");
    XLSX.utils.book_append_sheet(workbook, categorySheet, "Categories");
    XLSX.utils.book_append_sheet(workbook, brandSheet, "Brands");
    XLSX.utils.book_append_sheet(workbook, socketSheet, "Socket Type"); 
    XLSX.utils.book_append_sheet(workbook, ramSheet, "RAM Type");   

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  // ==========================
  // UPLOAD PRODUCT BARU
  // ==========================
  async uploadProducts(buffer: Buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    const dbBrands = await this.brandRepo.find();
    const brandMap = new Map(dbBrands.map(b => [b.name.trim().toLowerCase(), b]));

    let totalCreated = 0;
    const errors: string[] = [];

    const groupedProducts = new Map<number, { mainRow: any; variantsRows: any[] }>();
    let currentGroupId = 0;

    for (const row of rows) {
      const productName = row.name ? String(row.name).trim() : "";
      if (productName !== "") {
        currentGroupId++; 
        groupedProducts.set(currentGroupId, { mainRow: row, variantsRows: [] });
      }
      if (currentGroupId === 0) continue; 
      groupedProducts.get(currentGroupId)!.variantsRows.push(row);
    }

    let processedCount = 0;

    for (const [key, group] of groupedProducts.entries()) {
      const { mainRow, variantsRows } = group;
      processedCount++;

      this.progressService.sendProgress(
        `Memproses upload produk: ${processedCount} dari ${groupedProducts.size}`, 
        Math.round((processedCount / groupedProducts.size) * 100)
      );

      try {
        if (!mainRow.category_code) throw new BadRequestException(`Category code wajib diisi untuk produk '${mainRow.name}'`);

        const category = await this.categoryRepo.findOne({ where: { code: mainRow.category_code } });
        if (!category) throw new BadRequestException(`Category code ${mainRow.category_code} tidak ditemukan`);

        let productBrand: Brand | null = null;
        if (mainRow.brand_name) {
          productBrand = brandMap.get(String(mainRow.brand_name).trim().toLowerCase()) || null;
          if (!productBrand) throw new BadRequestException(`Brand '${mainRow.brand_name}' tidak ditemukan`);
        }

        const product = new Product();
        product.id = mainRow.id || randomUUID();
        product.product_id = randomUUID();
        product.name = mainRow.name;
        product.description = mainRow.description;
        product.warranty = mainRow.warranty;
        
        product.variant_type_name = mainRow.variant_type_name ? String(mainRow.variant_type_name).trim() : null; 
        product.socket_type = mainRow.socket_type ? String(mainRow.socket_type).trim() : null;
        product.ram_type = mainRow.ram_type ? String(mainRow.ram_type).trim() : null;

        product.is_active = mainRow.is_active === true || mainRow.is_active === 'true';
        product.is_popular = mainRow.is_popular === true || mainRow.is_popular === 'true';
        product.category = category;
        if (productBrand) product.brand = productBrand;

        product.variants = variantsRows.map((vRow, vIndex) => {
          if (!vRow.sku_seller) throw new BadRequestException(`SKU seller wajib diisi (Baris Variasi ke-${vIndex + 1})`);
          return Object.assign(new ProductVariant(), {
            variant_name: vRow.variant_name ? String(vRow.variant_name).trim() : "Default",
            price_normal: Number(vRow.price_normal) || 0,
            price_discount: Number(vRow.price_discount) || 0,
            stock: Number(vRow.stock) || 0,
            sku_seller: String(vRow.sku_seller).trim(),
          });
        });

        const savedProduct = await this.productRepo.save(product);

        // 🔥 LOGIC GAMBAR (DENGAN SORT ORDER RESET PER VARIANT)
        const hasVariants = mainRow.variant_type_name && String(mainRow.variant_type_name).trim() !== "";

        if (!hasVariants) {
          let generalSortOrder = 0;
          for (let i = 1; i <= 10; i++) {
            const imageUrl = mainRow[`image_${i}`];
            if (imageUrl && String(imageUrl).trim() !== "") {
              const processed = await this.productService.processSingleImage(imageUrl, generalSortOrder);
              if (processed) {
                await this.productImageRepo.save({
                  product: savedProduct, variant_id: null,
                  image_url: processed.image_url, thumbnail_url: processed.thumbnail_url, sort_order: generalSortOrder,
                });
                generalSortOrder++;
              }
            }
          }
        } else {
          for (let vIndex = 0; vIndex < variantsRows.length; vIndex++) {
            const vRow = variantsRows[vIndex];
            const savedVariant = savedProduct.variants[vIndex];
            let variantSortOrder = 0; // Mereset counter gambar per baris variasi

            for (let i = 1; i <= 10; i++) {
              const variantImageUrl = vRow[`image_${i}`];
              if (variantImageUrl && String(variantImageUrl).trim() !== "") {
                const processed = await this.productService.processSingleImage(variantImageUrl, variantSortOrder);
                if (processed) {
                  await this.productImageRepo.save({
                    product: savedProduct, variant_id: savedVariant.id, 
                    image_url: processed.image_url, thumbnail_url: processed.thumbnail_url, sort_order: variantSortOrder,
                  });
                  variantSortOrder++;
                }
              }
            }
          }
        }

        totalCreated++;
      } catch (err: any) {
        errors.push(`[${mainRow.name || 'Unknown'}]: ${err.message}`);
      }
    }

    if (errors.length > 0) {
      this.progressService.sendProgress('Upload selesai dengan beberapa error', 100, { status: 'ERROR', action: 'upload', errors: errors, total_created: totalCreated });
    } else {
      this.progressService.sendProgress('Upload selesai!', 100, { status: 'SUCCESS', action: 'upload', total_processed: totalCreated });
    }
  }

  // ==========================
  // GENERATE TEMPLATE UPDATE
  // ==========================
  async generateUpdateTemplate(categoryCodes?: string[], onlyWithSku: boolean = true): Promise<Buffer> {
    const query = this.productRepo
      .createQueryBuilder("product")
      .leftJoinAndSelect("product.category", "category")
      .leftJoinAndSelect("product.brand", "brand")
      .leftJoinAndSelect("product.images", "images")
      .leftJoinAndSelect("product.variants", "variant") 
      .orderBy("product.name", "ASC")
      // 🔥 MENCEGAH URUTAN VARIASI ACAK: Sort berdasarkan waktu dibuat agar sesuai dengan urutan upload
      .addOrderBy("variant.created_at", "ASC") 
      .addOrderBy("images.sort_order", "ASC");

    if (categoryCodes && categoryCodes.length > 0) {
      query.andWhere("category.code IN (:...codes)", { codes: categoryCodes });
    }

    if (onlyWithSku) {
      query
        .andWhere("variant.sku_seller IS NOT NULL")
        .andWhere("TRIM(variant.sku_seller) != ''")
        .andWhere("LOWER(TRIM(variant.sku_seller)) != 'nan'");
    }

    const products = await query.getMany();

    const hardwareKeywords = ['ram', 'memory', 'motherboard', 'mobo', 'processor', 'cpu'];
    const includeHardwareCols = products.some(p => {
      const catName = (p.category?.name || '').toLowerCase();
      return hardwareKeywords.some(keyword => catName.includes(keyword));
    });

    const headers = [
      'id', 'variant_id',
      'name', 'description', 'variant_type_name', 'variant_name', 
      'price_normal', 'price_discount', 'stock', 'sku_seller',
      'warranty', 'brand_name', 'category_name', 'category_code'
    ];

    if (includeHardwareCols) headers.push('socket_type', 'ram_type');
    headers.push('is_active', 'is_popular', 'image_1', 'image_2', 'image_3', 'image_4', 'image_5', 'image_6', 'image_7', 'image_8', 'image_9', 'image_10');

    const rows: any[] = [];

    products.forEach(product => {
      const generalImages = Array(10).fill("");
      const variantImagesMap = new Map<string, string[]>();
      
      if (product.images?.length) {
        product.images.forEach(img => {
          if (!img.variant_id && img.sort_order >= 0 && img.sort_order <= 9) {
            generalImages[img.sort_order] = img.image_url;
          } else if (img.variant_id) {
            if (!variantImagesMap.has(img.variant_id)) variantImagesMap.set(img.variant_id, []);
            variantImagesMap.get(img.variant_id)!.push(img.image_url);
          }
        });
      }

      const clean = (val: any) => {
        if (val === null || val === undefined) return '';
        const str = String(val).trim().toLowerCase();
        return str === 'nan' ? '' : val;
      };

      const variants = product.variants && product.variants.length > 0 ? product.variants : [{} as any];
      const hasVariants = product.variant_type_name && product.variant_type_name.trim() !== "";

      variants.forEach((variant, index) => {
        const isFirst = index === 0; 
        const rowData = [
          product.id, variant.id || '', 
          isFirst ? product.name : '', isFirst ? product.description : '',
          isFirst ? (product.variant_type_name || '') : '', variant.variant_name || 'Default',
          variant.price_normal || 0, variant.price_discount || 0, variant.stock || 0,
          clean(variant.sku_seller),
          isFirst ? product.warranty : '', isFirst ? (product.brand?.name || '') : '',
          isFirst ? product.category?.name : '', isFirst ? product.category?.code : ''
        ];

        if (includeHardwareCols) rowData.push(isFirst ? (product.socket_type || '') : '', isFirst ? (product.ram_type || '') : '');

        const rowImages = Array(10).fill('');
        if (!hasVariants && isFirst) {
          for (let i = 0; i < 10; i++) rowImages[i] = generalImages[i];
        } else if (hasVariants && variant.id && variantImagesMap.has(variant.id)) {
          const vImgs = variantImagesMap.get(variant.id)!;
          for (let i = 0; i < Math.min(vImgs.length, 10); i++) rowImages[i] = vImgs[i];
        }

        rowData.push(isFirst ? product.is_active : '', isFirst ? product.is_popular : '', ...rowImages);
        rows.push(rowData);
      });
    });

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    
    const borderStyle = {
      top: { style: "thin", color: { rgb: "000000" } }, bottom: { style: "thin", color: { rgb: "000000" } },
      left: { style: "thin", color: { rgb: "000000" } }, right: { style: "thin", color: { rgb: "000000" } },
    };
    
    worksheet['!views'] = [{ state: 'frozen', ySplit: 1 }];
    headers.forEach((_, colIndex) => {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: colIndex });
      if (worksheet[cellAddress]) worksheet[cellAddress].s = { font: { bold: true }, fill: { fgColor: { rgb: "D9E1F2" } }, border: borderStyle };
    });

    const range = XLSX.utils.decode_range(worksheet['!ref'] || '');
    for (let R = 1; R <= range.e.r; ++R) {
      for (let C = 0; C <= range.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        let cell = worksheet[cellAddress] || { v: '', t: 's' };
        const isEmpty = cell.v === '' || cell.v === null || String(cell.v).toLowerCase() === 'nan';
        worksheet[cellAddress] = { ...cell, s: { ...(cell.s || {}), fill: isEmpty ? { fgColor: { rgb: "FFFFCC" } } : undefined, border: borderStyle } };
      }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Products");

    const categories = await this.categoryRepo.find({ order: { name: "ASC" } });
    const categorySheet = XLSX.utils.aoa_to_sheet([["category_name", "category_code"], ...categories.map(c => [c.name, c.code])]);
    XLSX.utils.book_append_sheet(workbook, categorySheet, "Categories");

    const brands = await this.brandRepo.find({ order: { name: "ASC" } });
    const brandSheet = XLSX.utils.aoa_to_sheet([["brand_name"], ...brands.map(b => [b.name])]);
    XLSX.utils.book_append_sheet(workbook, brandSheet, "Brands");

    const { sockets, rams } = await this.getDistinctTypes();
    const finalSockets = sockets.length > 0 ? sockets : ['LGA 1700', 'AM4', 'AM5'];
    const finalRams = rams.length > 0 ? rams : ['DDR4', 'DDR5'];

    const socketSheet = XLSX.utils.aoa_to_sheet([["socket_type"], ...finalSockets.map(s => [s])]);
    const ramSheet = XLSX.utils.aoa_to_sheet([["ram_type"], ...finalRams.map(r => [r])]);

    XLSX.utils.book_append_sheet(workbook, socketSheet, "Socket Types");
    XLSX.utils.book_append_sheet(workbook, ramSheet, "RAM Types");

    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  }

  // ==========================
  // UPDATE PRODUCTS
  // ==========================
  async updateProducts(buffer: Buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    
    const categories = await this.categoryRepo.find();
    const categoryMap = new Map(categories.map(c => [String(c.code).trim(), c]));

    const dbBrands = await this.brandRepo.find();
    const brandMap = new Map(dbBrands.map(b => [String(b.name).trim().toLowerCase(), b]));

    const groupedProducts = new Map<string, { mainRow: any; variantsRows: any[] }>();
    
    for (const row of rows) {
      if (!row.id) continue;
      if (!groupedProducts.has(row.id)) groupedProducts.set(row.id, { mainRow: row, variantsRows: [] });
      groupedProducts.get(row.id)!.variantsRows.push(row);
    }

    const ids = Array.from(groupedProducts.keys());
    const products = await this.productRepo.find({ where: { id: In(ids) }, relations: ['images', 'category', 'brand', 'variants'] });
    const productMap = new Map(products.map(p => [p.id, p]));
    const normalize = (val: any) => String(val ?? '').trim();

    let totalUpdated = 0;
    const errors: string[] = [];
    let processedCount = 0;

    for (const [productId, group] of groupedProducts.entries()) {
      const { mainRow, variantsRows } = group;
      processedCount++;

      this.progressService.sendProgress(`Memproses update produk: ${processedCount} dari ${groupedProducts.size}`, Math.round((processedCount / groupedProducts.size) * 100));

      try {
        let product = productMap.get(productId);
        if (!product) throw new BadRequestException(`Product dengan ID ${productId} tidak ditemukan`);

        const excelCategoryCode = mainRow.category_code ? normalize(mainRow.category_code) : null;
        if (excelCategoryCode) {
          const category = categoryMap.get(excelCategoryCode);
          if (!category) throw new BadRequestException(`Category code ${excelCategoryCode} tidak ditemukan`);
          product.category = category;
        }

        const excelBrandName = mainRow.brand_name ? normalize(mainRow.brand_name).toLowerCase() : null;
        if (excelBrandName) {
          const productBrand = brandMap.get(excelBrandName);
          if (!productBrand) throw new BadRequestException(`Brand '${mainRow.brand_name}' tidak ditemukan`);
          product.brand = productBrand;
        }

        if (mainRow.name !== "") product.name = mainRow.name;
        if (mainRow.description !== "") product.description = mainRow.description;
        if (mainRow.warranty !== "") product.warranty = mainRow.warranty;
        if (mainRow.variant_type_name !== "") product.variant_type_name = String(mainRow.variant_type_name).trim();
        if (mainRow.socket_type !== "") product.socket_type = mainRow.socket_type ? String(mainRow.socket_type).trim() : null;
        if (mainRow.ram_type !== "") product.ram_type = mainRow.ram_type ? String(mainRow.ram_type).trim() : null;
        if (mainRow.is_active !== "") product.is_active = mainRow.is_active === true || mainRow.is_active === 'true';
        if (mainRow.is_popular !== "") product.is_popular = mainRow.is_popular === true || mainRow.is_popular === 'true';

        const currentVariantsMap = new Map(product.variants.map(v => [v.id, v]));
        const updatedVariants: ProductVariant[] = [];

        for (const vRow of variantsRows) {
          const variantId = vRow.variant_id;
          let variantData: any = (variantId && currentVariantsMap.has(variantId)) ? currentVariantsMap.get(variantId) : new ProductVariant();

          if (vRow.variant_name !== "") variantData.variant_name = String(vRow.variant_name).trim();
          if (vRow.price_normal !== "") variantData.price_normal = Number(vRow.price_normal);
          if (vRow.price_discount !== "") variantData.price_discount = Number(vRow.price_discount);
          if (vRow.stock !== "") variantData.stock = Number(vRow.stock);
          if (vRow.sku_seller !== "") variantData.sku_seller = String(vRow.sku_seller).trim();

          updatedVariants.push(variantData);
        }

        product.variants = updatedVariants;
        await this.productRepo.save(product);
        totalUpdated++;

        // ==========================
        // 🔥 UPDATE GAMBAR (SMART SYNC + MENDUKUNG PATH LOCAL)
        // ==========================
        const existingImages = await this.productImageRepo.find({ where: { product: { id: product.id } } });
        const hasVariants = mainRow.variant_type_name && String(mainRow.variant_type_name).trim() !== "";

        if (!hasVariants) {
          // UPDATE GAMBAR UMUM (Produk Tanpa Variasi)
          let generalImages = existingImages.filter(img => !img.variant_id);
          const newImageUrls: string[] = []; // 🔥 FIX TS2345
          
          for (let i = 1; i <= 10; i++) {
            const url = mainRow[`image_${i}`];
            if (url && String(url).trim() !== "") newImageUrls.push(String(url).trim());
          }

          let sortOrder = 0;
          for (const newUrl of newImageUrls) {
            const matchedIdx = generalImages.findIndex(img => img.image_url === newUrl);
            
            if (matchedIdx !== -1) {
              // Jika gambar sudah ada di DB (bisa /uploads/ atau http://)
              const matchedImg = generalImages[matchedIdx];
              matchedImg.sort_order = sortOrder++;
              await this.productImageRepo.save(matchedImg);
              generalImages.splice(matchedIdx, 1);
            } else if (newUrl.startsWith("http")) { // 🔥 FIX TS2339
              // Jika gambar benar-benar baru dari URL luar
              try {
                const processed = await this.productService.processSingleImage(newUrl, sortOrder);
                if (processed) {
                  if (generalImages.length > 0) {
                    const toReplace = generalImages.shift()!;
                    if (toReplace.image_url !== processed.image_url) await this.productService.deletePhysicalImage(toReplace.image_url);
                    if (toReplace.thumbnail_url !== processed.thumbnail_url) await this.productService.deletePhysicalImage(toReplace.thumbnail_url);
                    
                    toReplace.image_url = processed.image_url;
                    toReplace.thumbnail_url = processed.thumbnail_url;
                    toReplace.sort_order = sortOrder++;
                    await this.productImageRepo.save(toReplace);
                  } else {
                    await this.productImageRepo.save({ product, variant_id: null, image_url: processed.image_url, thumbnail_url: processed.thumbnail_url, sort_order: sortOrder++ });
                  }
                }
              } catch (err) { this.logger.error(`Gagal memproses gambar baru ${newUrl}`, err); }
            }
          }

          // Hapus sisa gambar umum yang ada di DB tapi nggak ada di file excel
          for (const leftOver of generalImages) {
            await this.productService.deletePhysicalImage(leftOver.image_url);
            if(leftOver.thumbnail_url) await this.productService.deletePhysicalImage(leftOver.thumbnail_url);
            await this.productImageRepo.delete(leftOver.id);
          }

          // Cleanup gambar variasi (kalau produk tiba-tiba diganti jadi nggak punya variasi)
          const oldVariantImages = existingImages.filter(img => img.variant_id);
          for (const oldImg of oldVariantImages) {
            await this.productService.deletePhysicalImage(oldImg.image_url);
            if(oldImg.thumbnail_url) await this.productService.deletePhysicalImage(oldImg.thumbnail_url);
            await this.productImageRepo.delete(oldImg.id);
          }

        } else {
          // UPDATE GAMBAR VARIASI
          for (let vIndex = 0; vIndex < variantsRows.length; vIndex++) {
            const vRow = variantsRows[vIndex];
            const variantData = product.variants[vIndex]; 
            if (!variantData || !variantData.id) continue;

            let varImages = existingImages.filter(img => img.variant_id === variantData.id);
            const newImageUrls: string[] = []; // 🔥 FIX TS2345
            
            for (let i = 1; i <= 10; i++) {
              const url = vRow[`image_${i}`];
              if (url && String(url).trim() !== "") newImageUrls.push(String(url).trim());
            }

            let sortOrder = 0;
            for (const newUrl of newImageUrls) {
              const matchedIdx = varImages.findIndex(img => img.image_url === newUrl);
              
              if (matchedIdx !== -1) {
                // Jika gambar variasi sudah ada di DB (aman untuk path /uploads/ )
                const matchedImg = varImages[matchedIdx];
                matchedImg.sort_order = sortOrder++;
                await this.productImageRepo.save(matchedImg);
                varImages.splice(matchedIdx, 1);
              } else if (newUrl.startsWith("http")) { // 🔥 FIX TS2339
                // Jika URL variasi benar-benar baru
                try {
                  const processed = await this.productService.processSingleImage(newUrl, sortOrder);
                  if (processed) {
                    if (varImages.length > 0) {
                      const toReplace = varImages.shift()!;
                      if (toReplace.image_url !== processed.image_url) await this.productService.deletePhysicalImage(toReplace.image_url);
                      if (toReplace.thumbnail_url !== processed.thumbnail_url) await this.productService.deletePhysicalImage(toReplace.thumbnail_url);
                      
                      toReplace.image_url = processed.image_url;
                      toReplace.thumbnail_url = processed.thumbnail_url;
                      toReplace.sort_order = sortOrder++;
                      await this.productImageRepo.save(toReplace);
                    } else {
                      await this.productImageRepo.save({ product, variant_id: variantData.id, image_url: processed.image_url, thumbnail_url: processed.thumbnail_url, sort_order: sortOrder++ });
                    }
                  }
                } catch (err) { this.logger.error(`Gagal memproses gambar variasi ${newUrl}`, err); }
              }
            }

            for (const leftOver of varImages) {
              await this.productService.deletePhysicalImage(leftOver.image_url);
              if(leftOver.thumbnail_url) await this.productService.deletePhysicalImage(leftOver.thumbnail_url);
              await this.productImageRepo.delete(leftOver.id);
            }
          }

          const oldGeneralImages = existingImages.filter(img => !img.variant_id);
          for (const oldImg of oldGeneralImages) {
            await this.productService.deletePhysicalImage(oldImg.image_url);
            if(oldImg.thumbnail_url) await this.productService.deletePhysicalImage(oldImg.thumbnail_url);
            await this.productImageRepo.delete(oldImg.id);
          }
        }

      } catch (err: any) {
        errors.push(`[ID: ${productId}]: ${err.message}`);
      }
    }

    if (errors.length > 0) {
      this.progressService.sendProgress('Update selesai dengan beberapa error', 100, { status: 'ERROR', action: 'update', errors: errors });
    } else {
      this.progressService.sendProgress('Update selesai!', 100, { status: 'SUCCESS', action: 'update', total_processed: totalUpdated });
    }
  }
}