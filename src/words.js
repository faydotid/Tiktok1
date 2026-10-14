// Daftar kata 5 huruf bahasa Indonesia. Tambah/hapus sesuka kamu (pisahkan dengan spasi/baris baru).
// Kata yang bukan 5 huruf A-Z otomatis diabaikan.
const RAW = `
abang acara agama agung ajaib ajang akhir aktif alami ambil ampun angin angka antar antri apung arang arena arsip arwah asing atlet
badai badan bagus bahan bahwa bakar bakso balas balik bambu bantu bapak barat baris basah batas batik batuk bawah bayar bebas beban
begal belah belas belut benar benci benda benih berat beras besar besok betul bibir bijak bilik bisik bocah bodoh boros botak buaya
bubur budak bukan bukti bulan bulat bumbu bunga bunyi buram buruk busuk butir
cabai cabik cabut cacat cakap cakar calon canda capai capek catat cegah celah cepat cerah cerai ceria cinta coret curam cuaca cukup cukur
dadar dahak dahan dalam damai dapat darah darat datar dekat dekap depan desak dewan dosen dosis dunia dukun duduk
ejaan elang emosi empat fajar fakta fasih fitur
gagah gagal gajah galak galau ganas ganti garam garis garpu gelap gelas gelar gemuk genap gerak gigih gigit gubuk gugur gulai gulat
habis hadap hadir hakim halal halus hamil hampa hanya harap harga harum hasil hebat heran hewan hidup hijau hitam honor hujan hukum hutan
ikuti indah induk ingat ingin intan istri
jabat jahat jahit jajan jalan jalur jamur janda janji jarak jarum jatuh jawab jebak jelas jemur jenis jodoh jujur juara judul
kabar kabel kabut kacau kaget kakak kakek kalah kalau kamar kamus kanan kapal kapur karet karya kasar kasih kasur kawan kawat kebun kecil
kedai kejam kelas keluh kemas kenal kerja kerap keras kesal kikir kilat kirim kisah klaim koran korek kotak kotor kubur kumis kunci kursi
kuasa kuota kutub
labuh lagak lahan lahir laksa lalat lampu lapar lapis larut latih laris layak layar lebah lebar lebat lebih legam lemah lemak lemas lepas
letak letih lewat licin lilin lipat lirik lobak logam lomba luang luhur lukis lulus luwes
macam macan mahal mahir malam malas mampu mandi manis manja marah masak masih masuk mawar mekar melon menit merah mesin mesra mimpi minta
minum mobil modal motor mudah mulai mulia mulut murah murid musik musim
nafas nakal nanas nasib nenek nilai nyali nyata nyawa nyala
obral ombak orang
padam padat pagar pahat pahit pajak pakai pakan palsu panas panen papan parah parit pasar pasir pasti patah patuh pecah pedas pelan peluk
penuh perak peran perut pesan pesta petir petik piala piano pikir pilih pintu pisau pohon pokok pulau pulih pupuk pusat putar putih putus
radio ragam rajin rakus rakit rambu ramai ramah rapat rapuh rawan rebah rebus rehat rekan rekor remuk resmi restu retak ribut rindu risau
robek rokok roman rumah rumit rumus rusak rusuh
sabar sabun sakit salah salam salju saran sawah sayap sayur sedap segar sehat sejuk selai selat semut senam senar senja sepak serat serba
serbu serta sesal sesat setia siang siapa sikap sikat silam singa sinar sirna sisir sisik situs sopan sorak subuh sudah sudut sukar sukma
sulap sulit sumur sunat sunyi supir surat surga susah susun suwir syair
tabah tabel tahan tahap tahun taman tamat tanah tanda tanpa tanya tapak tarik taruh tebal tebak tegak tegas teguh tekan telah telur tenda
tentu tepat tepuk terik terus tetap tiang tidak tidur tikus timba timur tinta tipis tokoh topan topik tubuh tugas tujuh tukar tulis tunai
tunas tunda tutup
udara ujian ulang umpan untuk upaya usaha usang utama utara
versi vital wajah wajar waktu walau warga warna wasit watak yakin yakni zaman zebra zakat zikir
`;

export const ANSWERS = [
  ...new Set(
    RAW.toUpperCase()
      .split(/\s+/)
      .filter((w) => /^[A-Z]{5}$/.test(w))
  ),
];

export const DICT = new Set(ANSWERS);
