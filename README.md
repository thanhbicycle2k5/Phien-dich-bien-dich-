# Phien-dich-bien-dich-

## Chạy giao diện mẫu

Mở `index.html` trong Chrome hoặc Edge. Không cần cài Node.js, React, backend hay API key.

Để tăng khả năng dùng được Web Speech API, có thể chạy từ localhost bằng Python có sẵn:

```bash
python3 -m http.server 8000
```

Sau đó mở http://localhost:8000. Trình duyệt có thể yêu cầu quyền micro. Web Speech API chỉ được hỗ trợ trên một số trình duyệt; khả năng nhận dạng ngoại tuyến tùy trình duyệt và ngôn ngữ, một số triển khai gửi âm thanh tới dịch vụ của nhà cung cấp trình duyệt. Vì vậy, không nên coi API này là giải pháp đảm bảo riêng tư hoặc chạy hoàn toàn offline.

## Có gì trong bản mẫu

- **Biên dịch:** 12 bài Anh–Việt, chia đều cho Kinh tế - Tài chính, Công nghệ thông tin, Chính trị - Xã hội và Y khoa. Mỗi bài có đáp án mẫu, thuật ngữ cốt lõi và ghi chú ngữ cảnh/văn phong. Chế độ tài liệu cá nhân cho phép dán văn bản, nhập `.txt` hoặc trích đoạn văn bản từ `.docx` bằng ZIP/`DecompressionStream`/`DOMParser` có sẵn trong trình duyệt, không tải thư viện từ mạng. Người học có thể tự nhập đáp án gợi ý và từ khóa để đối chiếu.
- **Tài liệu cá nhân:** nút lưu ghi nguồn, bản dịch nháp và gợi ý vào `localStorage`, giữ tối đa 10 tài liệu gần nhất để mở lại trên cùng trình duyệt. Mỗi ô giới hạn 50.000 ký tự; tệp tải lên giới hạn 10 MB. DOCX cần trình duyệt hỗ trợ `DecompressionStream("deflate-raw")`; nếu không, hãy lưu tệp thành `.txt`.
- **Đối chiếu:** điểm tương đồng dựa trên khoảng cách chỉnh sửa token; bộ đếm token không phân tích ngữ nghĩa. Từ khóa tự động chỉ là các token dài trong đáp án gợi ý, không thay thế việc tự đánh giá bản dịch.
- **Phiên dịch:** dùng `SpeechRecognition`/`webkitSpeechRecognition` trong trình duyệt để hiện lời nói thành văn bản; có thể chọn ngôn ngữ, bắt đầu/dừng, sao chép transcript và bấm giờ luyện tập.
- **Bài nghe cá nhân:** phát file MP3/WAV bằng `<audio>` hoặc MP4 bằng `<video>` từ object URL cục bộ; có thể nhập transcript/ghi chú/đáp án mẫu, kiểm tra số token và ghi âm phần dịch bằng `MediaRecorder` nếu trình duyệt cho phép micro. Ghi âm dùng tai nghe để hạn chế micro thu lại file nguồn.
- **Lịch sử:** nút lưu ghi transcript, bản dịch, ghi chú, tên file, ngôn ngữ, thời điểm và thời lượng vào `localStorage`, giữ tối đa 30 buổi gần nhất trên trình duyệt hiện tại. Bản ghi mic có thể nghe/tải ở player chính và mục lịch sử trong phiên hiện tại; Blob không được lưu vào `localStorage`, nên audio sẽ mất sau khi tải lại/đóng trang. File bài nghe cũng cần chọn lại sau khi tải lại. Lịch sử văn bản không được mã hóa; người dùng chung hồ sơ trình duyệt có thể xem dữ liệu. Có thể xóa lịch sử trong giao diện hoặc xóa dữ liệu trang của trình duyệt.
- **Đọc văn bản:** dùng `speechSynthesis` có sẵn trong trình duyệt nếu trình duyệt hỗ trợ giọng nói tương ứng.

## Lộ trình chạy AI hoàn toàn local

1. **Giao diện:** giữ HTML mẫu để thử nhanh; khi cần mở rộng, chuyển sang React + Vite. Không cần dịch vụ lưu trữ hay API bên ngoài.
2. **Backend:** cài Python, tạo môi trường ảo rồi cài FastAPI và Uvicorn (`pip install fastapi uvicorn`). Chạy API tại `127.0.0.1`; chỉ cho phép giao diện local truy cập bằng CORS.
3. **Nhận dạng giọng nói offline:** dùng `faster-whisper` hoặc `whisper.cpp` trên máy, tải model một lần rồi xử lý âm thanh cục bộ. Cần kiểm tra giấy phép model, dung lượng tải và cấu hình máy. Web Speech API không thay thế được yêu cầu offline nghiêm ngặt.
4. **Gợi ý/chấm bản dịch:** bắt đầu bằng bài mẫu và từ điển cục bộ. Nếu cần mô hình sinh ngôn ngữ, cài Ollama rồi tải một model nhỏ phù hợp phần cứng; gửi yêu cầu tới Ollama qua `localhost`, không dùng API trả phí. Model local vẫn tốn dung lượng và tài nguyên máy.
5. **Đảm bảo offline:** tải trước mã nguồn, model và dữ liệu cần thiết; sau đó ngắt mạng để kiểm thử. Không gọi các CDN, dịch vụ đám mây hay API bên thứ ba trong luồng xử lý.

Bản hiện tại là frontend minh họa, chưa kết nối FastAPI, Whisper hay Ollama. Để xác nhận một ứng dụng thực sự ngoại tuyến, cần kiểm tra riêng toàn bộ đường đi của âm thanh, model, font và dữ liệu.