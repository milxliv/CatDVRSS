
$(document).ready(function() {
  $('#dataForm').parsley();

  window.addEventListener("dragover",function(e){
    e = e || event;
    e.preventDefault();
  },false);
  window.addEventListener("drop",function(e){
    e = e || event;
    e.preventDefault();
  },false);
});

var r = new Resumable({
    target:'/upload',
    maxFileSize: 4*1024*1024*1024,
    chunkSize:1*1024*1024,
    simultaneousUploads:4,
    testChunks:false,
    throttleProgressCallbacks:1,
    query: getFormData()
  });
// Resumable.js isn't supported, fall back on a different method
if(!r.support) {
  $('.resumable-error').show();
} else {
  // Show a place for dropping/selecting files
  $('#dropArea').show();
  r.assignDrop($('#dropArea'));
  r.assignBrowse($('#browseFile'));

  $("#dropZone").on( "dragenter", function(event){
    $("#dropArea").addClass("resumable-dragover");
    // console.log("drag enter");
  } );
  // $("#dropArea").on( "dragend", function(event){
  //   $("#dropArea").removeClass("resumable-dragover");
  // } );
  $("#dropZone").on( "dragleave", function(event){
    $("#dropArea").removeClass("resumable-dragover");
  } );

  // // Handle file add event
  r.on('fileAdded', function(file){
      if(!$('#dataForm').parsley().validate()){
        r.cancel();
        $("#dropZone").trigger("dragleave");
        return false;
      }
      // console.log("file Added");
      // console.log(file);

      // Show progress bar
      $('#dropProgress').show();
      // Actually start the upload
      r.opts.query = getFormData();
      r.opts.query.filename = file.fileName;
      console.log(r);
      r.upload();
    });
  // r.on('pause', function(){
  //     // Show resume, hide pause
  //     $('.resumable-progress .progress-resume-link').show();
  //     $('.resumable-progress .progress-pause-link').hide();
  //   });
  r.on('complete', function(){

    });
  r.on('fileSuccess', function(file,message){
    window.location.href = "/";
  });
  r.on('fileError', function(file, message){

    });
  r.on('fileProgress', function(file){
      // Handle progress for both the file and the overall upload
      $('#dropProgress').css({width:Math.floor(r.progress()*100) + '%'});
      $('#progressNum').text(Math.round(r.progress()*100) + '%');
    });
  // r.on('cancel', function(){
  //   $('.resumable-file-progress').html('canceled');
  // });
  r.on('uploadStart', function(){
    $('#dropArea').hide();
    $('#dropProgressDiv').show();
    console.log("upload start");
    $(":submit").prop('disabled', true);
    $(":submit").hide();
    $("#submitMessage").show();
  });

}

function getFormData(){
  console.log("Here comes the data");
  var paramObj = {};
  $.each($('#dataForm').serializeArray(), function(_, kv) {
    paramObj[kv.name] = kv.value;
  });
  // return {this: "KGTV"};
  console.log(paramObj);
  return paramObj;
}
