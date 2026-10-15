# Liner Music Self-Hosted Server (Oracle Cloud Ready)

Server API độc lập và siêu nhẹ dành cho Liner Desktop Player.

## Tính năng
- **Tốc độ cao (< 30ms):** Đặt server ngay tại vùng của bạn (US / SG / JP), không bị nghẽn qua Ba Lan.
- **Tương thích 100% nhạc Việt & Quốc tế:** Tìm kiếm, phát nhạc, trích xuất Opus/AAC chất lượng cao từ YouTube Music.
- **Hỗ trợ Radio / Up Next:** Không bao giờ bị lỗi 502 khi phát tiếp các bài hát liên quan.
- **Đồng bộ lời bài hát (Synced Lyrics):** Kết nối LRCLIB tải lời bài hát chạy chữ theo từng từ.

---

## Cách cài đặt trên Oracle Cloud (Ubuntu / Debian)

### Bước 1: Mở Port 3000 trên Oracle Cloud Console (Web)
1. Vào **Oracle Cloud Console** -> **Networking** -> **Virtual Cloud Networks (VCN)**.
2. Chọn VCN của bạn -> bấm vào **Security Lists** -> chọn **Default Security List**.
3. Bấm **Add Ingress Rules**:
   - **Source CIDR:** `0.0.0.0/0`
   - **IP Protocol:** `TCP`
   - **Destination Port Range:** `3000`
   - Bấm **Add Ingress Rules**.

### Bước 2: Chạy Server trên VPS
Chỉ cần SSH vào VPS Oracle của bạn và chạy 1 lệnh duy nhất:

```bash
git clone https://github.com/tuanluong8826/desktop.git && cd desktop
# Hoặc copy thư mục liner-server lên VPS
cd liner-server
bash setup.sh
```

Hoặc dùng Docker:
```bash
docker compose up -d --build
```

### Bước 3: Trỏ App Liner vào Server riêng của bạn
1. Mở **Liner Desktop** -> Bấm biểu tượng ⚙️ (Cài đặt) -> Chọn mục **Phát nhạc (Playback)**.
2. Tại phần **Máy chủ API & Kết nối (Server & Endpoint)**:
   - Chọn nút: **Tùy chỉnh**.
   - Nhập URL: `http://<IP_ORACLE_CỦA_BẠN>:3000` (ví dụ `http://152.67.12.34:3000`).
   - Bấm **Lưu URL** và bấm **Kiểm tra kết nối**.
   - Trạng thái sẽ hiện `200 OK (15ms)` màu xanh lá!
