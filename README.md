# Phien-dich-bien-dich-

## Chạy giao diện mẫu

Mở `index.html` trong Chrome hoặc Edge. Không cần cài Node.js, React, backend hay API key.

Để tăng khả năng dùng được Web Speech API, có thể chạy từ localhost bằng Python có sẵn:

```bash
python3 -m http.server 8000
```

Sau đó mở http://localhost:8000. Trình duyệt có thể yêu cầu quyền micro. Web Speech API chỉ được hỗ trợ trên một số trình duyệt; khả năng nhận dạng ngoại tuyến tùy trình duyệt và ngôn ngữ, một số triển khai gửi âm thanh tới dịch vụ của nhà cung cấp trình duyệt. Vì vậy, không nên coi API này là giải pháp đảm bảo riêng tư hoặc chạy hoàn toàn offline.

## Có gì trong bản mẫu

- **Biên dịch:** bài tập Anh–Việt/Việt–Anh có sẵn đáp án tham khảo cục bộ. Điểm tương đồng dựa trên khoảng cách chỉnh sửa từ; đây chỉ là gợi ý đối chiếu từ vựng, không đánh giá được độ đúng nghĩa hay chất lượng bản dịch.
- **Phiên dịch:** dùng `SpeechRecognition`/`webkitSpeechRecognition` trong trình duyệt để hiện lời nói thành văn bản; có thể chọn ngôn ngữ, bắt đầu/dừng, đọc lại transcript và sao chép.
- **Đọc văn bản:** dùng `speechSynthesis` có sẵn trong trình duyệt nếu trình duyệt hỗ trợ giọng nói tương ứng.

## Lộ trình chạy AI hoàn toàn local

1. **Giao diện:** giữ HTML mẫu để thử nhanh; khi cần mở rộng, chuyển sang React + Vite. Không cần dịch vụ lưu trữ hay API bên ngoài.
2. **Backend:** cài Python, tạo môi trường ảo rồi cài FastAPI và Uvicorn (`pip install fastapi uvicorn`). Chạy API tại `127.0.0.1`; chỉ cho phép giao diện local truy cập bằng CORS.
3. **Nhận dạng giọng nói offline:** dùng `faster-whisper` hoặc `whisper.cpp` trên máy, tải model một lần rồi xử lý âm thanh cục bộ. Cần kiểm tra giấy phép model, dung lượng tải và cấu hình máy. Web Speech API không thay thế được yêu cầu offline nghiêm ngặt.
4. **Gợi ý/chấm bản dịch:** bắt đầu bằng bài mẫu và từ điển cục bộ. Nếu cần mô hình sinh ngôn ngữ, cài Ollama rồi tải một model nhỏ phù hợp phần cứng; gửi yêu cầu tới Ollama qua `localhost`, không dùng API trả phí. Model local vẫn tốn dung lượng và tài nguyên máy.
5. **Đảm bảo offline:** tải trước mã nguồn, model và dữ liệu cần thiết; sau đó ngắt mạng để kiểm thử. Không gọi các CDN, dịch vụ đám mây hay API bên thứ ba trong luồng xử lý.

Bản hiện tại là frontend minh họa, chưa kết nối FastAPI, Whisper hay Ollama. Để xác nhận một ứng dụng thực sự ngoại tuyến, cần kiểm tra riêng toàn bộ đường đi của âm thanh, model, font và dữ liệu.